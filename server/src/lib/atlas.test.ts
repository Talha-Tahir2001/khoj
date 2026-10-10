import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, isValidVector, keywordSearch } from "./atlas.js";
import { getObservations } from "./data.js";
import type { ConditionObservation } from "@khoj/shared/types";

const OBS: ConditionObservation[] = [
    {
        _id: "galiyat-a",
        trail: "galiyat",
        date: "2026-10-14",
        conditions_text: "Muddy after rain, stream crossing high, overcast, cold morning",
        field_note: "Lower trail impassable past the waterfall. Ridge was fine but very windy.",
        outcome: "partial",
    },
    {
        _id: "galiyat-b",
        trail: "galiyat",
        date: "2026-10-02",
        conditions_text: "Dry, clear, cool morning, strong wind on the ridge",
        field_note: "Forest approach beautiful, ridge genuinely unpleasant in the wind.",
        outcome: "partial",
    },
    {
        _id: "babusar-a",
        trail: "babusar",
        date: "2026-10-05",
        conditions_text: "Cold, first snow of the season on the pass, sleet",
        field_note: "Road closed below the pass. Turned around at the barrier.",
        outcome: "bad",
    },
];

describe("isValidVector", () => {
    it("accepts exactly 768 dimensions", () => {
        expect(isValidVector(new Array(EMBEDDING_DIMENSIONS).fill(0.1))).toBe(true);
    });

    it("rejects the wrong length — a bad vector fails before it reaches Atlas", () => {
        expect(isValidVector(new Array(767).fill(0.1))).toBe(false);
        expect(isValidVector(new Array(769).fill(0.1))).toBe(false);
        expect(isValidVector([])).toBe(false);
    });

    it("rejects a non-array", () => {
        expect(isValidVector("not a vector")).toBe(false);
        expect(isValidVector(null)).toBe(false);
        expect(isValidVector(undefined)).toBe(false);
    });
});

describe("keywordSearch", () => {
    it("restricts results to the requested trail", () => {
        const hits = keywordSearch(OBS, "wind rain muddy", { trail: "galiyat" });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every((h) => h.trail === "galiyat")).toBe(true);
    });

    it("ranks the closer match first", () => {
        const hits = keywordSearch(OBS, "muddy stream crossing high", { trail: "galiyat" });
        expect(hits[0]?.date).toBe("2026-10-14");
    });

    it("excludes stopwords from matching", () => {
        // "the" and "with" appear in every note; they must not decide the ranking.
        const hits = keywordSearch(OBS, "the with and", { trail: "galiyat" });
        expect(hits).toHaveLength(0);
    });

    it("returns an empty array when nothing matches rather than everything", () => {
        expect(keywordSearch(OBS, "zzzzqqqq", { trail: "galiyat" })).toHaveLength(0);
    });

    it("respects the limit", () => {
        expect(keywordSearch(OBS, "wind", { trail: "galiyat", limit: 1 })).toHaveLength(1);
    });

    it("scores between 0 and 1", () => {
        for (const hit of keywordSearch(OBS, "muddy wind rain", { trail: "galiyat" })) {
            expect(hit.similarity).toBeGreaterThan(0);
            expect(hit.similarity).toBeLessThanOrEqual(1);
        }
    });
});

describe("seed corpus", () => {
    const observations = getObservations();

    it("is non-empty — retrieval is empty on day one without it", () => {
        expect(observations.length).toBeGreaterThan(0);
    });

    it("covers all six trails, so no trail retrieves nothing", () => {
        const trails = new Set(observations.map((o) => o.trail));
        expect(trails.size).toBe(6);
    });

    it("has more than one observation per trail — with one, every query returns it", () => {
        const counts = new Map<string, number>();
        for (const o of observations) counts.set(o.trail, (counts.get(o.trail) ?? 0) + 1);
        for (const [trail, count] of counts) {
            expect(count, `${trail} has ${count} observations`).toBeGreaterThan(1);
        }
    });

    it("has unique ids", () => {
        const ids = observations.map((o) => o._id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("has no empty condition text or field notes", () => {
        for (const o of observations) {
            expect(o.conditions_text.trim(), o._id).not.toBe("");
            expect(o.field_note.trim(), o._id).not.toBe("");
        }
    });

    it("includes both positive and negative outcomes", () => {
        const outcomes = new Set(observations.map((o) => o.outcome));
        expect(outcomes.has("good")).toBe(true);
        expect(outcomes.has("bad")).toBe(true);
    });

    it("returns non-empty keyword results for every trail", () => {
        const trails = [...new Set(observations.map((o) => o.trail))];
        for (const trail of trails) {
            const sample = observations.find((o) => o.trail === trail)!;
            const hits = keywordSearch(observations, sample.conditions_text, { trail });
            expect(hits.length, `retrieval for ${trail}`).toBeGreaterThan(0);
        }
    });
});