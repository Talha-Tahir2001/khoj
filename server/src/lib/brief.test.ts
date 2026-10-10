import { describe, expect, it } from "vitest";
import { ruleBrief, trimToSentences } from "./brief.js";
import type { BriefInput } from "./brief.js";
import type { ScoredDay, Trail } from "@khoj/shared/types";

const TRAIL: Trail = {
    id: "galiyat",
    name: "Galiyat",
    lat: 34.1667,
    lon: 73.38,
    elevation_m: 2600,
    difficulty: "moderate",
    typical_hours: 5,
    notes: "",
};

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

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
    trail: TRAIL,
    day: DAY,
    similar: [],
    live_reports: [],
    ...over,
});

describe("trimToSentences", () => {
    it("keeps at most the requested number of sentences", () => {
        expect(trimToSentences("One. Two. Three. Four.", 3)).toBe("One. Two. Three.");
    });

    it("returns shorter text unchanged", () => {
        expect(trimToSentences("One. Two.", 3)).toBe("One. Two.");
    });

    it("handles text with no terminal punctuation", () => {
        expect(trimToSentences("no punctuation here", 3)).toBe("no punctuation here");
    });
});

describe("ruleBrief", () => {
    it("is three sentences — a brief nobody hears is not a brief", () => {
        const text = ruleBrief(input());
        const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
        expect(sentences).toHaveLength(3);
    });

    /**
     * The model is given the score and never computes one (FR4). The fallback is
     * built from the same numbers, so it structurally cannot contradict the
     * verdict — that is the property this test protects.
     */
it("agrees with the band it was given", () => {
expect(ruleBrief(input({ day: { ...DAY, band: "GO" } }))).toContain("Good day");
expect(ruleBrief(input({ day: { ...DAY, band: "MAYBE" } }))).toContain("Marginal");
expect(ruleBrief(input({ day: { ...DAY, band: "NO" } }))).toContain("Do not drive");
});

it("names the worst penalty, not a vague summary", () => {
const text = ruleBrief(
input({
day: {
...DAY,
penalties: [
{ key: "windPenalty", label: "Strong wind", points: 9, detail: "" },
{ key: "mudPenalty", label: "Wet ground from recent rain", points: 18, detail: "" },
],
},
}),
);
expect(text).toContain("wet ground from recent rain");
expect(text).toContain("18 points");
});

it("quotes the temperature and wind it was given", () => {
const text = ruleBrief(input());
expect(text).toContain("21°C");
expect(text).toContain("14 km/h");
});

it("cites a retrieved observation when one exists", () => {
const text = ruleBrief(
input({
similar: [
{
date: "2026-10-14",
field_note: "Lower trail impassable past the waterfall.",
similarity: 0.83,
outcome: "partial",
trail: "galiyat",
trail_name: "galiyat",
},
],
}),
);
expect(text).toContain("impassable");
});

/**
 * Three sentences is a hard limit, so the score has to survive the truncation
 * rather than being the sentence that gets dropped.
 */
it("keeps the score inside three sentences", () => {
const text = ruleBrief(
input({
similar: [
{
date: "2026-10-14",
field_note: "Lower trail impassable past the waterfall.",
similarity: 0.83,
outcome: "partial",
trail: "galiyat",
trail_name: "galiyat",
},
],
}),
);
expect((text.match(/[^.!?]+[.!?]+/g) ?? [])).toHaveLength(3);
expect(text).toContain("74 out of 100");
});

it("does not invent a score when retrieval succeeded", () => {
const text = ruleBrief(
input({
similar: [
{
date: "2026-10-14",
field_note: "Lower trail impassable.",
similarity: 0.83,
outcome: "partial",
trail: "galiyat",
trail_name: "galiyat",
},
],
}),
);
expect(text).not.toContain("No past observations");
});
});