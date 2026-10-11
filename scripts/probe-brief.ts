import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
    if (existsSync(resolve(ROOT, ".env"))) {
        const { config } = await import("dotenv");
        config({ path: resolve(ROOT, ".env") });
    }
    const { loadConfig, hasGemma } = await import("../server/src/lib/config.js");
    const { generateBrief } = await import("../server/src/lib/brief.js");
    const { getTrail } = await import("../server/src/lib/data.js");
    const { scoreDay } = await import("../server/src/lib/scoring.js");

    const c = loadConfig();
    console.log("hasGemma:", hasGemma(c));
    console.log("GEMINI_ENABLED:", c.GEMINI_ENABLED, "| key set:", Boolean(c.GEMINI_API_KEY));
    console.log("BASE:", c.GEMINI_BASE_URL);
    console.log("PROJECT:", c.GOOGLE_CLOUD_PROJECT, "LOC:", c.GOOGLE_CLOUD_LOCATION);
    console.log("MODEL:", c.GEMINI_MODEL);

    const trail = getTrail("babusar")!;
    const day = scoreDay({
        date: "2026-10-17",
        tmax_c: 5,
        tmin_c: -2,
        precip_mm: 2,
        snow_cm: 1,
        wind_max_kmh: 12,
        weather_code: 71,
        daylight_seconds: 11 * 3600,
        prior3_mm: 20,
        elevation_m: trail.elevation_m,
    });

    const started = Date.now();
    const brief = await generateBrief(c, { trail, day, similar: [], live_reports: [] }, null, "probe");
    console.log(`\ntook ${Date.now() - started}ms`);
    console.log("source:", brief.source, "| model:", brief.model);
    console.log("reason:", brief.reason);
    console.log("text:", brief.text);
}

main().catch((e) => console.log("ERR " + e.message));