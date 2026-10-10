import { z } from "zod";
import type { WeatherDay } from "@khoj/shared/types";
import { MUD_LOOKBACK_DAYS } from "@khoj/shared/scoring-rules";
import type { Config } from "./config.js";

export const MAX_FORECAST_DAYS = 16;

const OPEN_METHO_CODES = z.object({
    generationtime_ms: z.number().optional(),
    error: z.boolean().optional(),
    reason: z.string().optional(),
    daily: z
        .object({
            time: z.array(z.string()),
            temperature_2m_max: z.array(z.number().nullable()).optional(),
            temperature_2m_min: z.array(z.number().nullable()).optional(),
            precipitation_sum: z.array(z.number().nullable()).optional(),
            snowfall_sum: z.array(z.number().nullable()).optional(),
            wind_speed_10m_max: z.array(z.number().nullable()).optional(),
            weather_code: z.array(z.number().nullable()).optional(),
            daylight_duration: z.array(z.number().nullable()).optional(),
        })
        .optional(),
});

const num = (v: number | null | undefined, fallback = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

export class WeatherUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WeatherUnavailableError";
    }
}

/**
 * Fetch a daily forecast for a point. No API key required — that is load-bearing
 * on a short deadline, because the data layer cannot be rate-limited or revoked
 * mid-build.
 *
 * This is the only hard failure in the app: there is no score without weather.
 */
export async function fetchForecast(
    config: Config,
    point: { lat: number; lon: number },
    days: number,
): Promise<WeatherDay[]> {
    const limit = Math.min(Math.max(1, days), MAX_FORECAST_DAYS);
    const url = new URL(`${config.OPEN_METHO_BASE_URL}/forecast`);

    url.searchParams.set("latitude", String(point.lat));
    url.searchParams.set("longitude", String(point.lon));
    url.searchParams.set(
        "daily",
        [
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "snowfall_sum",
            "wind_speed_10m_max",
            "weather_code",
            "daylight_duration",
        ].join(","),
    );
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("forecast_days", String(limit));
    url.searchParams.set("timezone", "auto");

    let body: unknown;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
            throw new WeatherUnavailableError(
                `Open-Meteo responded ${res.status}. No score without weather.`,
            );
        }
        body = await res.json();
    } catch (err) {
        if (err instanceof WeatherUnavailableError) throw err;
        throw new WeatherUnavailableError(
            `Could not reach Open-Meteo: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    const parsed = OPEN_METHO_CODES.safeParse(body);
    if (!parsed.success) {
        throw new WeatherUnavailableError(`Open-Meteo response was not understood: ${parsed.error.message}`);
    }
    const { daily } = parsed.data;
    if (!daily || daily.time.length === 0) {
        throw new WeatherUnavailableError("Open-Meteo returned no daily rows.");
    }

    return daily.time.slice(0, limit).map((date, i) => ({
        date,
        tmax_c: num(daily.temperature_2m_max?.[i]),
        tmin_c: num(daily.temperature_2m_min?.[i]),
        precip_mm: num(daily.precipitation_sum?.[i]),
        snow_cm: num(daily.snowfall_sum?.[i]),
        wind_max_kmh: num(daily.wind_speed_10m_max?.[i]),
        weather_code: num(daily.weather_code?.[i]),
        daylight_seconds: num(daily.daylight_duration?.[i]),
    }));
}

/**
 * Rainfall over the days preceding a forecast day.
 *
 * Open-Meteo only returns the forward window, so day 0 has no history and gets
 * 0. That is a real limitation — the mud penalty cannot see rain that fell before
 * the window opens — and it is why the corpus matters: retrieval recovers the
 * qualitative picture the number misses.
 */
export function priorRainfall(days: WeatherDay[], index: number): number {
    if (index <= 0) return 0;
    const start = Math.max(0, index - MUD_LOOKBACK_DAYS);
    let total = 0;
    for (let i = start; i < index; i++) {
        total += days[i]!.precip_mm;
    }
    return total;
}