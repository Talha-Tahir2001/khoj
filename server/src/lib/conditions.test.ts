import { describe, expect, it } from "vitest";
import { conditionsText, focalDay } from "./conditions.js";
import type { ScoredDay } from "@khoj/shared/types";

const DAY: ScoredDay = {
    date: "2026-10-17",
    tmax_c: 21.4,
    tmin_c: 12,
    precip_mm: 0,
    snow_cm: 0,
    wind_max_kmh: 14,
    weather_code: 2,
    daylight_seconds: 11 * 3600,
    score: 74,
    band: "GO",
    penalties: [],
    bonus: [],
};

describe("conditionsText", () => {
    it("describes a clean day without inventing hazards", () => {
        const text = conditionsText(DAY);
        expect(text).toContain("dry, clear and calm");
        expect(text).toContain("21°C");
        expect(text).not.toContain("rain");
        expect(text).not.toContain("fog");
    });

    it("mentions rain, snow, wind and fog only when present", () => {
        const text = conditionsText({
            ...DAY,
            precip_mm: 6,
            snow_cm: 2,
            wind_max_kmh: 35,
            weather_code: 45,
        });
        expect(text).toContain("6 mm rain");
        expect(text).toContain("2 cm snow");
        expect(text).toContain("wind to 35 km/h");
        expect(text).toContain("fog");
    });

    it("ignores sub-0.5mm precipitation, which is not rain", () => {
        expect(conditionsText({ ...DAY, precip_mm: 0.4 })).not.toContain("rain");
    });

    it("ignores fog when the weather code is not a fog code", () => {
        expect(conditionsText({ ...DAY, weather_code: 61 })).not.toContain("fog");
    });

it("names the penalties it is describing", () => {
const text = conditionsText({
...DAY,
penalties: [
{ key: "mudPenalty", label: "Wet ground from recent rain", points: 18, detail: "" },
{ key: "windPenalty", label: "Strong wind", points: 9, detail: "" },
],
});
expect(text).toContain("Wet ground from recent rain");
expect(text).toContain("strong wind");
});

    /**
     * The client and server both own this function. If they drift, the same day
     * embeds into two different vectors and the two retrieval paths disagree.
     */
    it("is deterministic", () => {
        expect(conditionsText(DAY)).toBe(conditionsText(DAY));
    });
});

describe("focalDay", () => {
    it("returns the best-scoring day, which is the one worth driving to", () => {
        const best = focalDay([
            { ...DAY, date: "2026-10-17", score: 41, band: "NO" },
            { ...DAY, date: "2026-10-18", score: 86, band: "GO" },
            { ...DAY, date: "2026-10-19", score: 62, band: "MAYBE" },
        ]);
        expect(best?.date).toBe("2026-10-18");
    });

    it("returns null for an empty window", () => {
        expect(focalDay([])).toBeNull();
    });

    it("returns the only day when there is one", () => {
        expect(focalDay([DAY])?.date).toBe("2026-10-17");
    });
});