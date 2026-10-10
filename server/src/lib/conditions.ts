import type { ScoredDay } from "@khoj/shared/types";

/**
 * Turn a scored day into the sentence that gets embedded.
 *
 * The CLIENT owns this function in production — it builds the text in the
 * browser, embeds it, and sends only the resulting vector (NF1). The server
 * keeps a copy for the keyword-search fallback and for logging, where no vector
 * was supplied. Both must produce the same phrasing or the two retrieval paths
 * return different results for the same day.
 */
export function conditionsText(day: ScoredDay): string {
    const parts: string[] = [];

    const weather: string[] = [];
    if (day.precip_mm > 0.5) weather.push(`${day.precip_mm} mm rain`);
    if (day.snow_cm > 0) weather.push(`${day.snow_cm} cm snow`);
    if (day.wind_max_kmh >= 20) weather.push(`wind to ${day.wind_max_kmh} km/h`);
    if (weather_code_is_fog(day.weather_code)) weather.push("fog");
    if (day.weather_code === 95) weather.push("thunderstorm");

    parts.push(
        weather.length > 0
            ? `Weather: ${weather.join(", ")}.`
            : `Weather: dry, clear and calm.`,
    );

    parts.push(`High of ${Math.round(day.tmax_c)}°C.`);

    if (day.penalties.length > 0) {
        const labels = day.penalties.map((p) => p.label.toLowerCase());
        parts.push(`${sentenceCase(labels.join(", "))}.`);
    } else {
        parts.push("Nothing in the forecast penalises it.");
    }

    return parts.join(" ");
}

const weather_code_is_fog = (code: number): boolean => code === 45 || code === 48;

const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The single day whose conditions the client embeds and sends. */
export function focalDay(days: ScoredDay[]): ScoredDay | null {
    if (days.length === 0) return null;
    // Best-scoring day in the window: the one a user would actually drive to.
    return days.reduce((best, d) => (d.score > best.score ? d : best), days[0]!);
}