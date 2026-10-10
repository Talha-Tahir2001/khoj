import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { loadConfig } from "./lib/config.js";
import { getDb } from "./lib/mongo.js";
import { getTrails } from "./lib/data.js";
import { initObservability } from "./lib/observability.js";
import { advice, ApiError } from "./routes/advice.js";
import { health } from "./routes/health.js";

const config = loadConfig();
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
if (!db) {
    console.warn("[khoj] MONGO_URI not set — running without Atlas. Retrieval falls back to keyword match.");
}

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`[khoj] API listening on http://localhost:${info.port}`);
});