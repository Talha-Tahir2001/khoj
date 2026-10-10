import type { Band, Penalty, ScoredDay, WeatherDay } from "@khoj/shared/types";
import {
    BANDS,
    FOG_CODES,
    HEAT_THRESHOLD_C,
    MAX_DAYLIGHT_BONUS,
    MAX_PENALTY,
    MUD_LOOKBACK_DAYS,
    MUD_THRESHOLD_MM,
    PRECIP_THRESHOLD_MM,
    SNOW_ELEVATION_CEIL_M,
    SNOW_ELEVATION_FLOOR_M,
    VIABILITY_CEILING,
    WIND_THRESHOLD_KMH,
} from "@khoj/shared/scoring-rules";

/** Upper bound of each linear ramp, at which the penalty reaches its maximum. */
const RAMP_MAX = {
    precip_mm: 15,
    mud_mm: 60,
    wind_kmh: 60,
    heat_c: 45,
} as const;

/** Snow points per cm at maximum elevation. 1 cm ≈ 12 points at 3,800 m. */
const SNOW_POINTS_PER_CM = 12;

/** Daylight ramp endpoints, seconds. */
const DAYLIGHT_FLOOR_S = 9 * 3600;
const DAYLIGHT_CEIL_S = 13 * 3600;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Linear ramp from 0 at `from` to `max` at `to`. Returns 0 below `from`. */
const ramp = (value: number, from: number, to: number, max: number): number => {
    if (value <= from) return 0;
    return round1(Math.min(max, ((value - from) / (to - from)) * max));
};

export function bandFor(score: number): Band {
    if (score >= BANDS.GO_MIN) return "GO";
    if (score >= BANDS.MAYBE_MIN) return "MAYBE";
    return "NO";
}

/**
 * Rain today. Above the threshold it costs steeply — an outright washout
 * ends the hike.
 */
export function precipPenalty(precip_mm: number): Penalty | null {
    const points = ramp(precip_mm, PRECIP_THRESHOLD_MM, RAMP_MAX.precip_mm, MAX_PENALTY.precip);
    if (points === 0) return null;
    return {
        key: "precipPenalty",
        label: "Rain today",
        points,
        detail: `${round1(precip_mm)} mm forecast`,
    };
}

/**
 * Rain in the days before. Ground stays saturated after the rain stops —
 * this is the term that catches post-monsoon mud, and the one that matters
 * most for the lower reaches of Kaghan and Murree.
 */
export function mudPenalty(prior3_mm: number): Penalty | null {
    const points = ramp(prior3_mm, MUD_THRESHOLD_MM, RAMP_MAX.mud_mm, MAX_PENALTY.mud);
    if (points === 0) return null;
    return {
        key: "mudPenalty",
        label: "Wet ground from recent rain",
        points,
        detail: `${round1(prior3_mm)} mm in the prior ${MUD_LOOKBACK_DAYS} days`,
    };
}

/** Ridge wind. Above 20 km/h the exposed sections stop being pleasant. */
export function windPenalty(wind_max_kmh: number): Penalty | null {
    const points = ramp(wind_max_kmh, WIND_THRESHOLD_KMH, RAMP_MAX.wind_kmh, MAX_PENALTY.wind);
    if (points === 0) return null;
    return {
        key: "windPenalty",
        label: "Strong wind",
        points,
        detail: `gusts to ${round1(wind_max_kmh)} km/h`,
    };
}

/** Heat. Valleys get genuinely hot before October is out. */
export function heatPenalty(tmax_c: number): Penalty | null {
    const points = ramp(tmax_c, HEAT_THRESHOLD_C, RAMP_MAX.heat_c, MAX_PENALTY.heat);
    if (points === 0) return null;
    return {
        key: "heatPenalty",
        label: "Too hot",
        points,
        detail: `${round1(tmax_c)}°C forecast high`,
    };
}

/** Fog. Kills the view, which is usually the point. */
export function visibilityPenalty(weather_code: number): Penalty | null {
    if (!FOG_CODES.includes(weather_code)) return null;
    return {
        key: "visibilityPenalty",
        label: "Fog",
        points: MAX_PENALTY.visibility,
        detail: `weather code ${weather_code}`,
    };
}

/**
 * Snow, scaled by elevation.
 *
 * The same centimetre means very different things at 1,300 m and 3,800 m, so
 * severity is linear between the floor and ceiling elevations. Daman-e-Koh
 * is unaffected below the floor no matter what the forecast says; Babusar is
 * punished for the first flake.
 */
export function snowPenalty(snow_cm: number, elevation_m: number): Penalty | null {
    if (snow_cm <= 0 || elevation_m < SNOW_ELEVATION_FLOOR_M) return null;
    const severity = clamp(
        (elevation_m - SNOW_ELEVATION_FLOOR_M) /
            (SNOW_ELEVATION_CEIL_M - SNOW_ELEVATION_FLOOR_M),
        0,
        1,
    );
    const points = round1(clamp(snow_cm * SNOW_POINTS_PER_CM * severity, 0, MAX_PENALTY.snow));
    if (points === 0) return null;
    return {
        key: "snowPenalty",
        label: "Snow at altitude",
        points,
        detail: `${round1(snow_cm)} cm forecast at ${elevation_m} m`,
    };
}

/** Longer days are better. A bonus, so it is reported separately from penalties. */
export function daylightBonus(daylight_seconds: number): Penalty | null {
    if (daylight_seconds <= DAYLIGHT_FLOOR_S) return null;
    const points = round1(
        clamp(
            ((daylight_seconds - DAYLIGHT_FLOOR_S) / (DAYLIGHT_CEIL_S - DAYLIGHT_FLOOR_S)) *
                MAX_DAYLIGHT_BONUS,
            0,
            MAX_DAYLIGHT_BONUS,
        ),
    );
    if (points === 0) return null;
    return {
        key: "daylightBonus",
        label: "Long daylight",
        points,
        detail: `${(daylight_seconds / 3600).toFixed(1)} hours of daylight`,
    };
}

export interface ScoreInput extends WeatherDay {
    /** Rainfall summed over the preceding MUD_LOOKBACK_DAYS. */
    prior3_mm: number;
    elevation_m: number;
}

/**
 * Score one trail-day. Pure: no clock, no network, no I/O.
 *
 * Penalties are returned individually so the UI can show why — a bare number
 * is not something anyone would act on.
 */
export function scoreDay(input: ScoreInput): ScoredDay {
    const candidates = [
        precipPenalty(input.precip_mm),
        mudPenalty(input.prior3_mm),
        windPenalty(input.wind_max_kmh),
        heatPenalty(input.tmax_c),
        visibilityPenalty(input.weather_code),
        snowPenalty(input.snow_cm, input.elevation_m),
    ];

    const penalties = candidates.filter((p): p is Penalty => p !== null);
    const deducted = penalties.reduce((sum, p) => sum + p.points, 0);

    // A long day only helps if the day is otherwise viable. See VIABILITY_CEILING.
    const viable = deducted < VIABILITY_CEILING;
    const bonus = viable ? daylightBonus(input.daylight_seconds) : null;

    const added = bonus ? bonus.points : 0;
    const score = Math.round(clamp(100 - deducted + added, 0, 100));

    return {
        date: input.date,
        tmax_c: input.tmax_c,
        tmin_c: input.tmin_c,
        precip_mm: input.precip_mm,
        snow_cm: input.snow_cm,
        wind_max_kmh: input.wind_max_kmh,
        weather_code: input.weather_code,
        daylight_seconds: input.daylight_seconds,
        score,
        band: bandFor(score),
        penalties,
        bonus: bonus ? [bonus] : [],
    };
}

export function scoreDays(inputs: ScoreInput[]): ScoredDay[] {
    return inputs.map(scoreDay);
}