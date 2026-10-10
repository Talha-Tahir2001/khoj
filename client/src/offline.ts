import type { AdviceResponse } from "@khoj/shared/types";

export interface CachedAdvice extends AdviceResponse {
    /** Whether retrieval used a locally-computed vector or the keyword fallback. */
    embeddedLocally: boolean;
}

const TTL_MS = Number(import.meta.env.VITE_OFFLINE_CACHE_TTL_MS ?? 43_200_000);
const KEY_PREFIX = "khoj:advice";

/**
 * Offline cache for the last-fetched advice per trail.
 *
 * The app is making driving decisions. Showing the last-known forecast, clearly
 * marked with when it was fetched, beats showing nothing — and it absolutely
 * beats re-scoring stale weather and presenting it as current, which is why
 * nothing here re-runs the scorer.
 */

const key = (trailId: string, days: number): string => `${KEY_PREFIX}:${trailId}:${days}`;

export function readCached(trailId: string, days: number): CachedAdvice | null {
    try {
        const raw = localStorage.getItem(key(trailId, days));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedAdvice;
        return parsed?.days?.length ? parsed : null;
    } catch {
        return null;
    }
}

export function writeCached(advice: CachedAdvice): void {
    try {
        localStorage.setItem(key(advice.trail.id, advice.days.length), JSON.stringify(advice));
    } catch {
        // Quota exceeded — usually the audio data URL. The brief text still works
        // on the next request, so dropping the cache is survivable.
        try {
            const { brief, ...rest } = advice;
            localStorage.setItem(
                key(advice.trail.id, advice.days.length),
                JSON.stringify({ ...rest, brief: { ...brief, audio_url: undefined } }),
            );
        } catch {
            // Give up silently. An uncacheable response is not an error worth showing.
        }
    }
}

/** True if the cached copy is older than the TTL. Still shown, just flagged. */
export function isStale(advice: CachedAdvice): boolean {
    return Date.now() - new Date(advice.meta.generated_at).getTime() > TTL_MS;
}