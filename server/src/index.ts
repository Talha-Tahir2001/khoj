/**
 * Load .env explicitly, from the REPO ROOT.
 *
 * Two things make the implicit behaviour wrong here:
 *
 *  1. `tsx` and Node do not load .env at all. Without this every key in .env is
 *     invisible and the app quietly runs on nothing but its fallbacks.
 *  2. `npm run -w server` sets cwd to server/, so even a bare `dotenv/config`
 *     would look for server/.env — which does not exist. The .env file is one
 *     level up, at the repo root, deliberately: that is where the user copies it.
 *
 * In production there is no .env file. Render injects real environment
 * variables, dotenv finds nothing to override, and `override: false` means real
 * environment always wins.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_ENV = resolve(SERVER_DIR, "../../.env");
const SERVER_ENV = resolve(SERVER_DIR, "../.env");

for (const path of [ROOT_ENV, SERVER_ENV]) {
    if (existsSync(path)) loadDotenv({ path });
}

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { loadConfig, assertNoPlaceholders } from "./lib/config.js";
import { hasElevenLabs, hasGemma, hasSerpApi } from "./lib/config.js";
import { getDb } from "./lib/mongo.js";
import { getTrails } from "./lib/data.js";
import { initObservability } from "./lib/observability.js";
import { advice, ApiError } from "./routes/advice.js";
import { voice } from "./routes/voice.js";
import { health } from "./routes/health.js";

const config = loadConfig();
assertNoPlaceholders(config);
initObservability(config);

const app = new Hono();

// The Static Site and the Web Service are different *.onrender.com origins, so
// CORS must name the site origin in production.
app.use(
    "/api/*",
    cors({
        origin: [config.PUBLIC_SITE_ORIGIN, "http://localhost:5173"],
        allowMethods: ["GET", "OPTIONS"],
    }),
);

app.route("/api/health", health);
app.route("/api/advice", advice);
app.route("/api/voice", voice);

/** The trail catalog. Adding a trail is a data-only change (FR8). */
app.get("/api/trails", (c) => c.json({ trails: getTrails() }));

app.onError((err, c) => {
    const traceId = crypto.randomUUID();
    if (err instanceof ApiError) {
        return c.json(
            { error: true, code: err.code, message: err.message, trace_id: traceId },
            err.status as ContentfulStatusCode,
        );
    }
    console.error(`[khoj] ${traceId}`, err);
    return c.json(
        { error: true, code: "INTERNAL", message: "Something went wrong.", trace_id: traceId },
        500,
    );
});

app.notFound((c) =>
    c.json({ error: true, code: "NOT_FOUND", message: `No route for ${c.req.path}`, trace_id: null }, 404),
);

const db = getDb(config);

/**
 * Report which integrations are live.
 *
 * Every one of these has a fallback, so the app works with none of them — which
 * is exactly why a missing key used to go unnoticed. Startup now says plainly
 * what is enabled and what is degraded, so it is obvious which partner
 * integrations are actually exercised in this deployment.
 */
const enabled: string[] = ["Open-Meteo", "deterministic scoring"];
if (db) enabled.push("Atlas $vectorSearch");
if (hasGemma(config)) enabled.push(`${config.GEMINI_MODEL} briefs`);
if (hasSerpApi(config)) enabled.push("SerpApi live reports");
if (hasElevenLabs(config)) enabled.push("ElevenLabs audio");
if (config.SENTRY_DSN) enabled.push("Sentry gen_ai.* traces");

const missing: string[] = [];
if (!db) missing.push("MONGO_URI (retrieval falls back to keyword match)");
if (!hasGemma(config)) missing.push("GEMINI_API_KEY (rule-based brief)");
if (!hasElevenLabs(config)) missing.push("ELEVENLABS_API_KEY (text brief only)");
if (!hasSerpApi(config)) missing.push("SERPAPI_KEY (no live reports)");
if (!config.SENTRY_DSN) missing.push("SENTRY_DSN (no traces)");

console.log(`[khoj] enabled:  ${enabled.join(", ")}`);
if (missing.length > 0) {
    console.warn(`[khoj] degraded: ${missing.join(", ")}`);
}

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`[khoj] API listening on http://localhost:${info.port}`);
});