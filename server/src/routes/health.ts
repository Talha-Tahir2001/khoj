import { Hono } from "hono";

const startedAt = Date.now();

export const health = new Hono();

/**
 * Liveness probe for Render's health check and the keep-alive cron.
 *
 * The cron must target THIS path. Render intercepts /robots.txt while an
 * instance is spun down and that request does not wake it.
 */
health.get("/", (c) =>
    c.json({
        ok: true,
        uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    }),
);