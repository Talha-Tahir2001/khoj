/**
 * Gate G2 check: semantic retrieval must return a non-empty, self-consistent
 * result for every trail in the catalog.
 *
 * Each trail's own observation is embedded as the query. The correct behaviour
 * is that observation coming back first. A trail that fails this returns nothing
 * useful, which is the condition G2 exists to catch.
 *
 * Run: npx tsx scripts/verify-trails.ts
 */

import { pipeline, env } from "@huggingface/transformers";
import { getObservations, getTrails } from "../server/src/lib/data.js";

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
    const trails = getTrails();
    const vectors = new Map<string, number[]>();
    for (const o of observations) vectors.set(o._id, await embed(o.conditions_text));

    const cosine = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i]!, 0);

    console.log("G2 — retrieval non-empty for every trail in the catalog\n");
    let failures = 0;

    for (const trail of trails) {
        const pool = observations.filter((o) => o.trail === trail.id);
        if (pool.length === 0) {
            console.log(`  ${trail.id.padEnd(20)} NO OBSERVATIONS`);
            failures++;
            continue;
        }

        const probe = pool[0]!;
        const qv = await embed(probe.conditions_text);
        const ranked = pool
            .map((o) => ({ o, sim: cosine(qv, vectors.get(o._id)!) }))
            .sort((a, b) => b.sim - a.sim);

        const top = ranked[0]!;
        const selfTop = top.o._id === probe._id;
        if (!selfTop) failures++;

        console.log(
            `  ${trail.id.padEnd(20)} n=${String(pool.length).padEnd(3)} top=${top.sim.toFixed(4)}  ${selfTop ? "PASS" : `FAIL (got ${top.o._id})`}`,
        );
    }

    console.log(`\n${failures === 0 ? "G2 PASS" : `G2 FAIL — ${failures} trail(s)`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});