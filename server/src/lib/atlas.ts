import type { Db } from "mongodb";
import type { ConditionObservation, Trail } from "@khoj/shared/types";
import type { Config } from "./config.js";

/**
 * EmbeddingGemma-300M emits 768 dimensions.
 *
 * A wrong numDimensions fails at INSERT time, not query time, so this is
 * asserted against the actual vector before it is used.
 */
export const EMBEDDING_DIMENSIONS = 768;

export interface SimilarCondition {
    date: string;
    field_note: string;
    similarity: number;
    outcome: string;
    trail: string;
    trail_name: string;
    conditions_text?: string;
}

interface ProjectionObservation {
    date: string;
    field_note: string;
    outcome: string;
    trail: string;
    conditions_text?: string;
    score?: number;
}

const asFloat32 = (vector: number[]): Float32Array => Float32Array.from(vector);

/** Reject a vector the Atlas index could never accept. */
export function isValidVector(vector: unknown): vector is number[] {
    return Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS;
}

/**
 * `$vectorSearch` against the Atlas vector index.
 *
 * `filter` restricts to the requested trail. That is deliberate: the useful
 * comparison is "days that felt like this *on this trail*", not days from a
 * different mountain that happen to have similar weather.
 */
export async function vectorSearch(
    db: Db,
    vector: number[],
    opts: { trail?: string; limit?: number },
): Promise<SimilarCondition[]> {
    const { trail, limit = 4 } = opts;
    const collection = db.collection<ConditionObservation>("observations");

    const search: Record<string, unknown> = {
        index: "vector_index",
        path: "embedding",
        queryVector: asFloat32(vector),
        numCandidates: 100,
        limit,
    };
    if (trail) search.filter = { trail };

    const filterStage = trail ? { $match: { trail } } : {};

    const docs = await collection
        .aggregate<ProjectionObservation>([
            { $vectorSearch: search as never },
            filterStage,
            {
                $project: {
                    _id: 0,
                    date: 1,
                    field_note: 1,
                    outcome: 1,
                    trail: 1,
                    conditions_text: 1,
                    // Atlas returns a normalized 0-1 cosine score under this key.
                    score: { $meta: "vectorSearchScore" },
                },
            },
        ])
        .toArray();

    return docs.map((d) => ({
        date: d.date,
        field_note: d.field_note,
        outcome: d.outcome,
        trail: d.trail,
        trail_name: d.trail,
        similarity: typeof d.score === "number" ? Math.round(d.score * 1000) / 1000 : 0,
    }));
}

/**
 * Keyword fallback, used when Atlas is unreachable or the vector is absent.
 *
 * This is a cut-list item (PLAN.md), not the preferred path — lexical matching
 * genuinely cannot bridge "muddy after rain" to "the lower path was a mess after
 * Wednesday's rain". It exists so retrieval degrades instead of vanishing.
 */
export function keywordSearch(
    observations: ConditionObservation[],
    text: string,
    opts: { trail?: string; limit?: number },
): SimilarCondition[] {
    const { trail, limit = 4 } = opts;
    const pool = trail ? observations.filter((o) => o.trail === trail) : observations;
    const terms = tokenize(text);

    // A query with no meaningful terms has no signal. Returning arbitrary records
    // here would present noise as a match — better to return nothing and let the
    // UI say retrieval found nothing comparable.
    if (terms.length === 0) return [];

    const ranked = pool
        .map((o) => {
            const haystack = tokenize(`${o.conditions_text} ${o.field_note}`);
            const hits = terms.filter((t) => haystack.includes(t)).length;
            // Overlap over query size, so a long note is not penalised for
            // containing more words than the query.
            return { o, score: hits / terms.length };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return ranked.map((r) => toSimilarCondition(r.o, r.score));
}

const STOPWORDS = new Set([
    "the","a","an","and","or","of","to","in","on","at","for","with","after","is","it","was",
    "that","this","very","from","had","has","but","not",
]);

const tokenize = (s: string): string[] =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));

function toSimilarCondition(o: ConditionObservation, score = 0): SimilarCondition {
    return {
        date: o.date,
        field_note: o.field_note,
        outcome: o.outcome,
        trail: o.trail,
        trail_name: o.trail,
        similarity: Math.round(score * 1000) / 1000,
    };
}

/**
 * Retrieval entry point. Atlas first, keyword second, empty third.
 *
 * Never throws — an unreachable cluster must not take the score and brief down
 * with it.
 */
export async function retrieveSimilar(
    config: Config,
    db: Db | null,
    observations: ConditionObservation[],
    opts: { trail: Trail; text: string; vector?: number[] },
): Promise<{ results: SimilarCondition[]; source: "atlas" | "keyword" }> {
    if (db && opts.vector && isValidVector(opts.vector)) {
        try {
            const hits = await vectorSearch(db, opts.vector, { trail: opts.trail.id });
            if (hits.length > 0) return { results: hits, source: "atlas" };
        } catch {
            // Fall through. Atlas being down is not a reason to fail the request.
        }
    }
    const keyword = keywordSearch(observations, opts.text, { trail: opts.trail.id });
    return { results: keyword, source: "keyword" };
}