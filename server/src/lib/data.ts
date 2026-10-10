import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { ConditionObservation, Trail } from "@khoj/shared/types";

const trailSchema = z.object({
    id: z.string(),
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    elevation_m: z.number(),
    difficulty: z.enum(["easy", "moderate", "hard"]),
    typical_hours: z.number(),
    notes: z.string(),
});

const observationSchema = z.object({
    _id: z.string(),
    trail: z.string(),
    date: z.string(),
    conditions_text: z.string(),
    field_note: z.string(),
    outcome: z.enum(["good", "partial", "bad"]),
});

/** data/ lives at the repo root, one level above this package. */
const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data");

function loadData<T>(file: string, parse: (raw: unknown) => T): T {
    const raw = readFileSync(resolve(DATA_DIR, file), "utf8");
    return parse(JSON.parse(raw));
}

let trailsCache: Trail[] | null = null;

/**
 * The trail catalog. Adding a trail is a data-only change (FR8) — this file
 * and nothing else.
 */
export function getTrails(): Trail[] {
    if (trailsCache) return trailsCache;
    const parsed = z.array(trailSchema).safeParse(loadData("trails.json", (r) => r));
    if (!parsed.success) throw new Error(`data/trails.json is invalid: ${parsed.error.message}`);
    trailsCache = parsed.data;
    return trailsCache;
}

export function getTrail(id: string): Trail | null {
    return getTrails().find((t) => t.id === id) ?? null;
}

let observationsCache: ConditionObservation[] | null = null;

/**
 * The observation corpus retrieval searches. Small and hand-seeded — this is
 * the weakest part of the system and is disclosed as such.
 */
export function getObservations(): ConditionObservation[] {
    if (observationsCache) return observationsCache;
    const parsed = z.array(observationSchema).safeParse(loadData("conditions.json", (r) => r));
    if (!parsed.success) {
        throw new Error(`data/conditions.json is invalid: ${parsed.error.message}`);
    }
    observationsCache = parsed.data;
    return observationsCache;
}