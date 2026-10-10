import { describe, expect, it } from "vitest";
import { MUD_LOOKBACK_DAYS } from "@khoj/shared/scoring-rules";
import { MAX_FORECAST_DAYS, priorRainfall } from "./weather.js";
import type { WeatherDay } from "@khoj/shared/types";

const day = (date: string, precip: number): WeatherDay => ({
    date,
    tmax_c: 20,
    tmin_c: 10,
    precip_mm: precip,
    snow_cm: 0,
    wind_max_kmh: 8,
    weather_code: 1,
    daylight_seconds: 11 * 3600,
});

const WINDOW: WeatherDay[] = [
    day("2026-10-10", 1),
    day("2026-10-11", 2),
    day("2026-10-12", 3),
    day("2026-10-13", 4),
    day("2026-10-14", 5),
    day("2026-10-15", 6),
];

describe("priorRainfall", () => {
    it("is zero for the first day — Open-Meteo gives no history", () => {
        expect(priorRainfall(WINDOW, 0)).toBe(0);
    });

    it("sums the days immediately before", () => {
        expect(priorRainfall(WINDOW, 3)).toBe(1 + 2 + 3);
    });

    it(`looks back at most ${MUD_LOOKBACK_DAYS} days`, () => {
        // Day 5 would otherwise include all five previous days.
        expect(priorRainfall(WINDOW, 5)).toBe(3 + 4 + 5);
    });

    it("handles a window shorter than the lookback", () => {
        expect(priorRainfall(WINDOW.slice(0, 2), 1)).toBe(1);
    });

    it("is zero when it rained on none of the preceding days", () => {
        const dry = WINDOW.map((d) => ({ ...d, precip_mm: 0 }));
        expect(priorRainfall(dry, 4)).toBe(0);
    });
});

describe("forecast horizon", () => {
    it("is capped at 16 days, matching the Open-Meteo free tier", () => {
        expect(MAX_FORECAST_DAYS).toBe(16);
    });
});