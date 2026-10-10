import type { ScoredDay } from "@khoj/shared/types";
import { scoreDay, type ScoreInput } from "./scoring.js";

/**
 * Pluggable scorer.
 *
 * TabPFN was dropped from the core — there is no JS runtime for it, and its
 * REST API is a metered vendor call, which undercuts the "open at its core"
 * criterion. The interface stays so the option costs nothing to keep open.
 * See the decision log in PLAN.md.
 */
export interface Scorer {
    readonly name: string;
    score(input: ScoreInput): ScoredDay;
}

const rulesScorer: Scorer = {
    name: "rules",
    score: (input) => scoreDay(input),
};

export const scorers: Record<string, Scorer> = {
    rules: rulesScorer,
};