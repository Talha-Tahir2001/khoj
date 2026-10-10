import { Hono } from "hono";
import { z } from "zod";
import type { AdviceResponse, ScoredDay } from "@khoj/shared/types";
import { loadConfig } from "../lib/config.js";
import { getDb } from "../lib/mongo.js";
import { getObservations, getTrail } from "../lib/data.js";
import { cached, cacheStoreFor } from "../lib/cache.js";
import { MAX_FORECAST_DAYS, WeatherUnavailableError, fetchForecast, priorRainfall } from "../lib/weather.js";
import { scoreDay, type ScoreInput } from "../lib/scoring.js";
import { EMBEDDING_DIMENSIONS, retrieveSimilar } from "../lib/atlas.js";
import { generateBrief, type Brief } from "../lib/brief.js";
import { narrate } from "../lib/voice.js";
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

    const vector = parsed.data.embedding ? decodeEmbedding(parsed.data.embedding) : undefined;

    const requestId = crypto.randomUUID();
    const parentSpan = startAgentSpan(requestId);
    const conversationId = requestId;

    try {
        const db = getDb(config);
        const store = cacheStoreFor(db);
        const observations = getObservations();

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

        // ── 2. Scoring. Pure, no I/O, no clock. ────────────────────────────
        const inputs: ScoreInput[] = weather.map((w, i) => ({
            ...w,
            prior3_mm: priorRainfall(weather, i),
            elevation_m: trail.elevation_m,
        }));
        const scorer = scorers[config.SCORER] ?? scorers.rules!;
        const scored: ScoredDay[] = inputs.map((i) => scorer.score(i));

        // ── 3. Retrieval ───────────────────────────────────────────────────
        const focus = focalDay(scored);
        const text = focus ? conditionsText(focus) : "";
        const similar = await retrieveSimilar(config, db, observations, {
            trail,
            text,
            vector,
        });
        const named = similar.results.map((r) => ({
            date: r.date,
            field_note: r.field_note,
            similarity: r.similarity,
            outcome: r.outcome,
            trail: r.trail_name,
        }));

        // ── 4. Live reports, cached hard against the search budget ─────────
        const serp = await cached(
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
        );

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

        // ── 6. Voice ───────────────────────────────────────────────────────
        const audio = brief.text ? await narrate(config, brief.text) : null;

        const degraded =
            similar.source === "keyword" ||
            serp.value.length === 0 ||
            brief.source === "rule" ||
            audio === null;

        const body: AdviceResponse = {
            trail,
            days: scored,
            similar_conditions: named,
            brief: { ...brief, ...(audio ? { audio_url: audio } : {}) },
            live_reports: serp.value,
            meta: {
                cached: weatherCached,
                generated_at: new Date().toISOString(),
                model: brief.source === "gemma" ? config.GEMINI_MODEL : undefined,
                degraded,
            },
        };

        c.header("X-Cache", weatherCached ? "HIT" : "MISS");
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
});