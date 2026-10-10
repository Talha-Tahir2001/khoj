export type Band = "GO" | "MAYBE" | "NO";

export interface Trail {
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevation_m: number;
    difficulty: "easy" | "moderate" | "hard";
    typical_hours: number;
    notes: string;
}

export interface Penalty {
    key: string;
    label: string;
    points: number;
    detail: string;
}

export interface WeatherDay {
    date: string;
    tmax_c: number;
    tmin_c: number;
    precip_mm: number;
    snow_cm: number;
    wind_max_kmh: number;
    weather_code: number;
    daylight_seconds: number;
}

export interface ScoredDay extends WeatherDay {
    score: number;
    band: Band;
    penalties: Penalty[];
    bonus: Penalty[];
}

export interface ConditionObservation {
    _id: string;
    trail: string;
    date: string;
    conditions_text: string;
    field_note: string;
    outcome: "good" | "partial" | "bad";
    embedding?: number[];
}

export interface AdviceResponse {
    trail: Trail;
    days: ScoredDay[];
    similar_conditions: Array<{
        date: string;
        field_note: string;
        similarity: number;
        outcome: string;
        trail?: string;
    }>;
    brief: {
        text: string;
        source: "gemma" | "rule";
        audio_url?: string;
        /** Why the brief is rule-based, when it is. Null when the model wrote it. */
        reason?: string | null;
    };
    live_reports: Array<{
        title: string;
        snippet: string;
        url: string;
        source: string;
    }>;
    meta: {
        cached: boolean;
        generated_at: string;
        model?: string;
        degraded: boolean;
        /**
         * Why the response is degraded, per upstream. Absent when everything
         * worked. `degraded: true` with no explanation is useless — a quota
         * exhaustion and a flaky network need completely different responses.
         */
        reasons?: Record<string, string>;
    };
}