import { describe, expect, it } from "vitest";
import {
    bandFor,
    daylightBonus,
    heatPenalty,
    mudPenalty,
    precipPenalty,
    scoreDay,
    scoreDays,
    snowPenalty,
    visibilityPenalty,
    windPenalty,
    type ScoreInput,
} from "./scoring.js";
import {
    BANDS,
    FOG_CODES,
    HEAT_THRESHOLD_C,
    MAX_PENALTY,
    MUD_THRESHOLD_MM,
    PRECIP_THRESHOLD_MM,
    SNOW_ELEVATION_FLOOR_M,
    WIND_THRESHOLD_KMH,
} from "@khoj/shared/scoring-rules";

/** A perfect day: nothing wrong with it. Used as the baseline for isolation tests. */
const CLEAN: ScoreInput = {
    date: "2026-10-17",
    tmax_c: 21,
    tmin_c: 12,
    precip_mm: 0,
    prior3_mm: 0,
    snow_cm: 0,
    wind_max_kmh: 8,
    weather_code: 1,
    daylight_seconds: 11 * 3600,
    elevation_m: 1500,
};

const withOverrides = (over: Partial<ScoreInput>): ScoreInput => ({ ...CLEAN, ...over });

describe("bandFor", () => {
    it("maps scores to the documented bands", () => {
        expect(bandFor(100)).toBe("GO");
        expect(bandFor(BANDS.GO_MIN)).toBe("GO");
        expect(bandFor(BANDS.GO_MIN - 1)).toBe("MAYBE");
        expect(bandFor(BANDS.MAYBE_MIN)).toBe("MAYBE");
        expect(bandFor(BANDS.MAYBE_MIN - 1)).toBe("NO");
        expect(bandFor(0)).toBe("NO");
    });
});

describe("threshold boundaries", () => {
    it("does not fire below the precipitation threshold", () => {
        expect(precipPenalty(PRECIP_THRESHOLD_MM)).toBeNull();
        expect(precipPenalty(PRECIP_THRESHOLD_MM - 0.1)).toBeNull();
    });

    it("fires immediately above the precipitation threshold", () => {
        expect(precipPenalty(PRECIP_THRESHOLD_MM + 0.1)).not.toBeNull();
    });

    it("does not fire below the wind threshold", () => {
        expect(windPenalty(WIND_THRESHOLD_KMH)).toBeNull();
        expect(windPenalty(WIND_THRESHOLD_KMH - 1)).toBeNull();
        expect(windPenalty(WIND_THRESHOLD_KMH + 1)).not.toBeNull();
    });

    it("does not fire below the heat threshold", () => {
        expect(heatPenalty(HEAT_THRESHOLD_C)).toBeNull();
        expect(heatPenalty(HEAT_THRESHOLD_C + 1)).not.toBeNull();
    });

    it("does not fire below the mud threshold", () => {
        expect(mudPenalty(MUD_THRESHOLD_MM)).toBeNull();
        expect(mudPenalty(MUD_THRESHOLD_MM + 1)).not.toBeNull();
    });
});

describe("precipPenalty", () => {
    it("caps at the documented maximum", () => {
        expect(precipPenalty(15)?.points).toBe(MAX_PENALTY.precip);
        expect(precipPenalty(300)?.points).toBe(MAX_PENALTY.precip);
    });

    it("is monotonic in rainfall", () => {
        const points = [2.5, 5, 8, 12, 15].map((mm) => precipPenalty(mm)!.points);
        for (let i = 1; i < points.length; i++) {
            expect(points[i]!).toBeGreaterThan(points[i - 1]!);
        }
    });
});

describe("mudPenalty", () => {
    it("caps at the documented maximum", () => {
        expect(mudPenalty(60)?.points).toBe(MAX_PENALTY.mud);
        expect(mudPenalty(400)?.points).toBe(MAX_PENALTY.mud);
    });
});

describe("windPenalty", () => {
    it("caps at the documented maximum", () => {
        expect(windPenalty(60)?.points).toBe(MAX_PENALTY.wind);
        expect(windPenalty(200)?.points).toBe(MAX_PENALTY.wind);
    });
});

describe("heatPenalty", () => {
    it("caps at the documented maximum", () => {
        expect(heatPenalty(45)?.points).toBe(MAX_PENALTY.heat);
        expect(heatPenalty(60)?.points).toBe(MAX_PENALTY.heat);
    });
});

describe("visibilityPenalty", () => {
    it("fires for every documented fog code", () => {
        for (const code of FOG_CODES) {
            const p = visibilityPenalty(code);
            expect(p, `code ${code} should penalise`).not.toBeNull();
            expect(p!.points).toBe(MAX_PENALTY.visibility);
        }
    });

    it("does not fire for clear sky", () => {
        expect(visibilityPenalty(0)).toBeNull();
        expect(visibilityPenalty(1)).toBeNull();
    });

    it("does not fire for rain codes — precipPenalty owns those", () => {
        expect(visibilityPenalty(61)).toBeNull();
        expect(visibilityPenalty(95)).toBeNull();
    });
});

describe("snowPenalty", () => {
    it("does not fire below the elevation floor, however much snow", () => {
        expect(snowPenalty(50, 500)).toBeNull();
        expect(snowPenalty(50, SNOW_ELEVATION_FLOOR_M - 1)).toBeNull();
    });

    it("is non-zero above the elevation floor", () => {
        expect(snowPenalty(2, SNOW_ELEVATION_FLOOR_M + 100)).not.toBeNull();
    });

    it("costs more at higher elevation for the same snowfall", () => {
        const low = snowPenalty(3, 2200)!.points;
        const high = snowPenalty(3, 3800)!.points;
        expect(high).toBeGreaterThan(low);
    });

    it("does not fire with no snow regardless of elevation", () => {
        expect(snowPenalty(0, 3800)).toBeNull();
    });

    it("caps at the documented maximum", () => {
        expect(snowPenalty(100, 3800)?.points).toBe(MAX_PENALTY.snow);
    });
});

describe("daylightBonus", () => {
    it("is absent for short days", () => {
        expect(daylightBonus(8 * 3600)).toBeNull();
        expect(daylightBonus(9 * 3600)).toBeNull();
    });

    it("caps at the documented maximum", () => {
        expect(daylightBonus(13 * 3600)?.points).toBe(10);
        expect(daylightBonus(18 * 3600)?.points).toBe(10);
    });
});

describe("scoreDay", () => {
    it("scores a clean day as GO with no penalties", () => {
        const result = scoreDay(CLEAN);
        expect(result.penalties).toHaveLength(0);
        expect(result.band).toBe("GO");
        expect(result.score).toBeGreaterThanOrEqual(BANDS.GO_MIN);
    });

    it("isolates each penalty — only the expected one fires", () => {
        expect(scoreDay(withOverrides({ precip_mm: 10 })).penalties.map((p) => p.key)).toEqual([
            "precipPenalty",
        ]);
        expect(scoreDay(withOverrides({ prior3_mm: 30 })).penalties.map((p) => p.key)).toEqual([
            "mudPenalty",
        ]);
        expect(scoreDay(withOverrides({ wind_max_kmh: 45 })).penalties.map((p) => p.key)).toEqual([
            "windPenalty",
        ]);
        expect(scoreDay(withOverrides({ tmax_c: 40 })).penalties.map((p) => p.key)).toEqual([
            "heatPenalty",
        ]);
        expect(scoreDay(withOverrides({ weather_code: 45 })).penalties.map((p) => p.key)).toEqual([
            "visibilityPenalty",
        ]);
        expect(
            scoreDay(withOverrides({ snow_cm: 5, elevation_m: 3800 })).penalties.map((p) => p.key),
        ).toEqual(["snowPenalty"]);
    });

    it("reports the score as the sum of its parts", () => {
        const result = scoreDay(withOverrides({ precip_mm: 10, wind_max_kmh: 45 }));
        const deducted = result.penalties.reduce((s, p) => s + p.points, 0);
        const added = result.bonus.reduce((s, p) => s + p.points, 0);
        expect(result.score).toBe(Math.round(100 - deducted + added));
    });

    it("withholds the daylight bonus once the day stops being viable", () => {
        // Rainy and muddy: the bonus must not rescue this into MAYBE.
        const bad = scoreDay(withOverrides({ precip_mm: 25, prior3_mm: 80 }));
        expect(bad.bonus).toHaveLength(0);
        expect(bad.band).toBe("NO");
    });

    it("still awards the daylight bonus on an otherwise clean day", () => {
        const clean = scoreDay(CLEAN);
        expect(clean.bonus).toHaveLength(1);
        expect(clean.bonus[0]!.key).toBe("daylightBonus");
    });

    it("clamps to [0, 100]", () => {
        const terrible = scoreDay(
            withOverrides({
                precip_mm: 60,
                prior3_mm: 200,
                wind_max_kmh: 120,
                tmax_c: 55,
                weather_code: 48,
                snow_cm: 40,
                elevation_m: 3800,
                daylight_seconds: 8 * 3600,
            }),
        );
        expect(terrible.score).toBe(0);
        expect(terrible.band).toBe("NO");
    });

    it("is a pure function — same input, same output, no clock dependency", () => {
        expect(scoreDay(CLEAN)).toEqual(scoreDay(CLEAN));
    });

    it("returns every penalty with a human-readable detail string", () => {
        const result = scoreDay(withOverrides({ precip_mm: 10, prior3_mm: 30 }));
        for (const p of result.penalties) {
            expect(p.label).not.toBe("");
            expect(p.detail).not.toBe("");
            expect(p.points).toBeGreaterThan(0);
        }
    });

    it("penalises snow at Babusar but not at Daman-e-Koh for the same forecast", () => {
        const babusar = scoreDay(withOverrides({ snow_cm: 3, elevation_m: 3800 }));
        const damanEKoh = scoreDay(withOverrides({ snow_cm: 3, elevation_m: 1300 }));
        expect(babusar.penalties.map((p) => p.key)).toContain("snowPenalty");
        expect(damanEKoh.penalties.map((p) => p.key)).not.toContain("snowPenalty");
        expect(babusar.score).toBeLessThan(damanEKoh.score);
    });
});

describe("scoreDays", () => {
    it("scores each day independently", () => {
        const results = scoreDays([
            withOverrides({ date: "2026-10-17" }),
            withOverrides({ date: "2026-10-18", precip_mm: 25, prior3_mm: 80 }),
        ]);
        expect(results).toHaveLength(2);
        expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
        expect(results[1]!.band).toBe("NO");
    });
});