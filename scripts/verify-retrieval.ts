/**
 * Local verification that the embedding path actually discriminates.
 *
 * Answers the question the post will be judged on: does an embedding retrieve
 * a semantically matching field note that keyword search would miss?
 *
 * Run: npx tsx scripts/verify-retrieval.ts
 */

import { pipeline, env } from "@huggingface/transformers";
import { getObservations } from "../server/src/lib/data.js";
import { keywordSearch } from "../server/src/lib/atlas.js";

const QUERIES = [
    "Muddy after rain, stream crossing high, cold morning",
    "Fog sitting in the valley in the morning",
    "Strong wind on the exposed ridge",
    "Fresh snow on the pass, road closed",
];

const main = async () => {
    env.allowLocalModels = false;
    console.log("Loading EmbeddingGemma-300M (ONNX, q8, cpu)...\n");
    const extractor = await pipeline("feature-extraction", "onnx-community/embeddinggemma-300m-ONNX", {
        dtype: "q8",
        device: "cpu",
    });

    const embed = async (text: string): Promise<number[]> => {
        const out = await extractor(text, { pooling: "mean", normalize: true });
        return Array.from(out.data as Float32Array);
    };

    const observations = getObservations();
    const vectors = new Map<string, number[]>();
    for (const o of observations) vectors.set(o._id, await embed(o.conditions_text));

    console.log(`Embedded ${vectors.size} observations at ${vectors.get(observations[0]!._id)!.length} dimensions\n`);

    const cosine = (a: number[], b: number[]): number =>
        a.reduce((sum, x, i) => sum + x * b[i]!, 0);

    for (const q of QUERIES) {
        const qv = await embed(q);

        const semantic = observations
            .map((o) => ({
                o,
                sim: cosine(qv, vectors.get(o._id)!),
            }))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 3);

        const lexical = keywordSearch(observations, q, { limit: 3 });

        console.log(`QUERY  "${q}"`);
        console.log("  semantic (embeddings):");
        for (const r of semantic) {
            console.log(`    ${r.sim.toFixed(4)}  ${r.o._id}`);
            console.log(`             "${r.o.field_note.slice(0, 72)}"`);
        }
        console.log("  keyword (fallback):");
        for (const r of lexical) {
            console.log(`    ${r.similarity.toFixed(4)}  ${r.date}  ${r.trail}`);
        }
        console.log();
    }
};

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});