/**
 * Upstream health tracking.
 *
 * Two problems this solves, both of which showed up for real:
 *
 * 1. **Silent retry.** A service that returns 402/401 will never start working
 *    by being asked again. Retrying it per request adds latency to every call
 *    and produces exactly the outbound-traffic pattern Render may suspend a free
 *    instance for. So a hard failure trips a breaker and the upstream is skipped
 *    for a cool-off window.
 *
 * 2. **Undiagnosable degradation.** The response said `degraded: true` without
 *    saying why, so a quota exhaustion was indistinguishable from a transient
 *    blip. The reason is now carried through to the UI.
 */

export type Upstream = "gemini" | "elevenlabs" | "serpapi" | "atlas";

export type UpstreamStatus = "unknown" | "ok" | "failed";

interface State {
    status: UpstreamStatus;
    /** Why it failed, safe to show a user. */
    reason?: string;
    /** When the breaker opened, for the cool-off check. */
    since?: number;
    /** Consecutive failures. */
    failures: number;
}

const FAILURE_THRESHOLD = 2;
const COOLOFF_MS = 5 * 60_000;

const state = new Map<Upstream, State>();

/** HTTP statuses that mean "stop asking", as opposed to "try again". */
const HARD_FAILURES = new Set([401, 402, 403]);

export function noteOk(upstream: Upstream): void {
    const prev = state.get(upstream);
    if (prev?.status === "failed") {
        console.log(`[khoj] ${upstream} recovered`);
    }
    state.set(upstream, { status: "ok", failures: 0 });
}

/**
 * Record a failure, and decide whether it should open the breaker immediately.
 *
 * Billing and auth failures (401/402/403) are **deterministic** — asking again
 * cannot produce a different answer, so they trip the breaker on the first
 * occurrence. Timeouts and 5xx are transient and get two strikes, because a
 * brief network blip should not permanently disable a feature.
 */
export function noteFailure(
    upstream: Upstream,
    reason: string,
    hard = false,
): void {
    const prev = state.get(upstream);
    const failures = (prev?.failures ?? 0) + 1;
    const threshold = hard ? 1 : FAILURE_THRESHOLD;

    state.set(upstream, {
        status: failures >= threshold ? "failed" : "unknown",
        reason,
        since: Date.now(),
        failures,
    });

    if (failures === threshold) {
        console.warn(`[khoj] ${upstream} disabled for ${COOLOFF_MS / 1000}s — ${reason}`);
    }
}

/** True when the status means "stop asking" rather than "ask again". */
export function noteStatusFailure(upstream: Upstream, status: number, reason: string): void {
    noteFailure(upstream, reason, isHardFailure(status));
}

/**
 * True unless the upstream has failed enough times in a row to be worth
 * skipping. Falls back to a half-open attempt after the cool-off, so a transient
 * outage does not disable a feature for the rest of the process's life.
 */
export function shouldTry(upstream: Upstream): boolean {
    const s = state.get(upstream);
    if (!s || s.status !== "failed") return true;
    if (Date.now() - (s.since ?? 0) > COOLOFF_MS) {
        // Half-open: one attempt to test the water. The failure count is kept so
        // a second failure in this window re-opens the breaker immediately
        // rather than granting another grace attempt.
        state.set(upstream, {
            status: "unknown",
            reason: s.reason,
            since: Date.now(),
            failures: s.failures,
        });
        return true;
    }
    return false;
}

export function reasonFor(upstream: Upstream): string | undefined {
    return shouldTry(upstream) ? undefined : state.get(upstream)?.reason;
}

export function isHardFailure(status: number): boolean {
    return HARD_FAILURES.has(status);
}

/** Test seam. */
export function resetUpstreams(): void {
    state.clear();
}