import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AdviceResponse, ScoredDay, Trail } from "@khoj/shared/types";
import { loadConfig, hasElevenLabs, hasSerpApi, type Config } from "../lib/config.js";
import { getDb, withTimeout } from "../lib/mongo.js";
import { getObservations, getTrail } from "../lib/data.js";
import { cached, cacheStoreFor } from "../lib/cache.js";
import { MAX_FORECAST_DAYS, WeatherUnavailableError, fetchForecast, priorRainfall } from "../lib/weather.js";
import { scoreDay, type ScoreInput } from "../lib/scoring.js";
import { EMBEDDING_DIMENSIONS, retrieveSimilar } from "../lib/atlas.js";
import { generateBrief, briefUnavailableReason, type Brief } from "../lib/brief.js";
import { voiceUnavailableReason } from "../lib/voice.js";
import { shouldTry } from "../lib/upstream.js";
import { searchLiveReports } from "../lib/serp.js";
import { conditionsText, focalDay } from "../lib/conditions.js";
import { captureError, startAgentSpan, withToolSpan } from "../lib/observability.js";
import { scorers } from "../lib/scorer.js";

const querySchema = z.object({
    trail: z.string().min(1),
    days: z.coerce.number().int().min(1).max(MAX_FORECAST_DAYS).default(7),
    embedding: z.string().optional(),
});

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/** Decode the client's base64 Float32Array. A wrong length is a 400, not a 500. */
export function decodeEmbedding(b64: string): number[] {
    let bytes: Buffer;
    try {
        bytes = Buffer.from(b64, "base64");
    } catch {
        throw new ApiError(400, "INVALID_EMBEDDING", "embedding is not decodable");
    }
    if (bytes.byteLength === 0 || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
        throw new ApiError(
            400,
            "INVALID_EMBEDDING",
            `embedding byte length ${bytes.byteLength} is not a whole number of 32-bit floats`,
        );
    }
    const floats = new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
    const out = Array.from(floats);
    if (out.length !== EMBEDDING_DIMENSIONS) {
        throw new ApiError(
            400,
            "INVALID_EMBEDDING",
            `embedding must be ${EMBEDDING_DIMENSIONS} dimensions, got ${out.length}`,
        );
    }
    return out;
}

export const advice = new Hono();

advice.get("/", async (c) => {
    const config = loadConfig();
    const q = c.req.query();
    const parsed = querySchema.safeParse({
        trail: q.trail,
        days: q.days,
        embedding: q.embedding,
    });
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        const code = first?.path[0] === "days" ? "INVALID_DAYS" : "INVALID_QUERY";
        throw new ApiError(400, code, first?.message ?? "invalid query");
    }

    const { trail: trailId, days } = parsed.data;
    const trail = getTrail(trailId);
    if (!trail) throw new ApiError(400, "UNKNOWN_TRAIL", `No trail with id '${trailId}'`);

    // Hard ceiling on the whole request.
    //
    // Every individual upstream is already bounded, but four bounded calls in
    // sequence can still add up to something a person on 4G will not wait for.
    // This is a decision tool, not a dashboard: a slightly degraded answer
    // arriving fast beats a complete one arriving after the trailhead.
    return withTimeout(
        buildAdvice(c, config, trail, days),
        REQUEST_TIMEOUT_MS,
        () => {
            throw new ApiError(504, "UPSTREAM_TIMEOUT", "Upstream took too long. Try again.");
        },
    );
});

/** Decode the embedding if one was sent, else undefined. Invalid vectors are a 400. */
function parsedEmbedding(c: { req: { query(): Record<string, string> } }): number[] | undefined {
    const raw = c.req.query().embedding;
    return raw ? decodeEmbedding(raw) : undefined;
}

/** The whole request, bounded by REQUEST_TIMEOUT_MS. */
const REQUEST_TIMEOUT_MS = 20_000;

/** `Server-Timing: forecast;dur=812, brief;dur=1204, total;dur=2400` */
function formatServerTiming(timings: Record<string, number>): string {
    return Object.entries(timings)
        .map(([name, ms]) => `${name.replace(/\+/g, "")};dur=${Math.round(ms)}`)
        .join(", ");
}

async function buildAdvice(
    c: Context,
    config: Config,
    trail: Trail,
    days: number,
): Promise<Response> {
    // Per-stage timing. Not just debugging: the challenge's Sentry category asks
    // for latency numbers, and a total alone cannot tell you which upstream is
    // the expensive one.
    const t0 = Date.now();
    let mark = t0;
    const timings: Record<string, number> = {};
    const stage = (name: string) => {
        const now = Date.now();
        timings[name] = now - mark;
        mark = now;
        if (config.NODE_ENV === "development") {
            console.log(`[khoj]   ${name}: ${timings[name]}ms`);
        }
    };

    const vector = parsedEmbedding(c);
    const requestId = crypto.randomUUID();
    const parentSpan = startAgentSpan(requestId);
    const conversationId = requestId;

    try {
        const db = getDb(config);
        const store = cacheStoreFor(db);
        const observations = getObservations();
        stage("setup");

        // ── 1. Weather, cached ──────────────────────────────────────────────
        const { value: weather, hit: weatherCached } = await cached(
            `forecast:${trail.id}:${days}`,
            config.CACHE_TTL_FORECAST,
            store,
            async () => {
                const rows = await withToolSpan(
                    parentSpan,
                    "get_forecast",
                    { "khoj.trail": trail.id, "khoj.days": days },
                    () => fetchForecast(config, trail, days),
                );
                return rows.result;
            },
        );
        stage("forecast");

        // ── 2. Scoring. Pure, no I/O, no clock. ────────────────────────────
        const inputs: ScoreInput[] = weather.map((w, i) => ({
            ...w,
            prior3_mm: priorRainfall(weather, i),
            elevation_m: trail.elevation_m,
        }));
        const scorer = scorers[config.SCORER] ?? scorers.rules!;
        const scored: ScoredDay[] = inputs.map((i) => scorer.score(i));

        // ── 3 & 4. Retrieval and live reports run concurrently ──────────────
        //
        // They are independent, and serialising them made the request budget
        // the sum of both rather than the slower of the two. Retrieval depends
        // only on the scored day; SerpApi does not depend on retrieval at all.
        const focus = focalDay(scored);
        const text = focus ? conditionsText(focus) : "";

        const [similar, serp] = await Promise.all([
            retrieveSimilar(config, db, observations, { trail, text, vector }),
            cached(
                `serp:${trail.id}`,
                config.CACHE_TTL_SERP,
                store,
                async () => {
                    const rows = await withToolSpan(
                        parentSpan,
                        "search_live_reports",
                        { "khoj.trail": trail.id },
                        () => searchLiveReports(config, trail.name),
                    );
                    return rows.result;
                },
            ),
        ]);

        stage("retrieve+serp");

        const named = similar.results.map((r) => ({
            date: r.date,
            field_note: r.field_note,
            similarity: r.similarity,
            outcome: r.outcome,
            trail: r.trail_name,
        }));

        // ── 5. Brief ───────────────────────────────────────────────────────
        let brief: Brief = {
            text: "No forecast available for this window.",
            source: "rule",
        };
        if (focus) {
            brief = await generateBrief(
                config,
                { trail, day: focus, similar: similar.results, live_reports: serp.value },
                parentSpan,
                conversationId,
            );
        }
        stage("brief");

        // ── 6. Voice ───────────────────────────────────────────────────────
        // Deliberately NOT awaited here.
        //
        // Speech synthesis took 660 ms when it worked and over 20 s when it did
        // not, and blocking a driving decision on it was the single largest
        // contributor to response time. Audio is the first thing on the cut
        // list; the verdict is not. The client fetches it separately, on demand,
        // via /api/voice when the user actually presses play.
        stage("voice");

        // Say WHY things degraded. A bare `degraded: true` is undiagnosable —
        // and the two most likely causes here (billing exhausted vs. flaky
        // network) need completely different responses from whoever is reading it.
        const reasons: Record<string, string> = {};
        if (similar.source === "keyword") {
            reasons.retrieval = db
                ? "Atlas unreachable — fell back to keyword search, which cannot match phrasing."
                : "Atlas not configured — keyword search only.";
        }
        if (brief.source === "rule") {
            reasons.brief = briefUnavailableReason() ?? "Briefing model not configured.";
        }
        if (hasElevenLabs(config) && !shouldTry("elevenlabs")) {
            reasons.audio = voiceUnavailableReason() ?? "Speech unavailable.";
        } else if (!hasElevenLabs(config)) {
            reasons.audio = "Speech not configured — the brief is text-only.";
        }
        if (serp.value.length === 0) {
            reasons.live_reports = hasSerpApi(config)
                ? "No recent web mentions found for this trail."
                : "SerpApi not configured.";
        }

        const degraded = Object.keys(reasons).length > 0;

        const body: AdviceResponse = {
            trail,
            days: scored,
            similar_conditions: named,
            brief: {
                ...brief,
                reason: brief.source === "rule" ? (reasons.brief ?? null) : null,
            },
            live_reports: serp.value,
            meta: {
                cached: weatherCached,
                generated_at: new Date().toISOString(),
                model: brief.model,
                degraded,
                ...(degraded ? { reasons } : {}),
            },
        };

        c.header("X-Cache", weatherCached ? "HIT" : "MISS");
        // Surface the breakdown so a slow request can be attributed without
        // attaching a debugger.
        c.header("Server-Timing", formatServerTiming(timings));
        timings.total = Date.now() - t0;
        return c.json(body);
    } catch (err) {
        if (err instanceof WeatherUnavailableError) {
            throw new ApiError(503, "WEATHER_UNAVAILABLE", err.message);
        }
        captureError(err, { trail: trail.id, requestId });
        throw err;
    } finally {
        parentSpan.end();
    }
}