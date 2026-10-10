/**
 * Prove `$vectorSearch` end to end against the live Atlas index.
 *
 * Uses a real EmbeddingGemma vector taken from the corpus itself as the query,
 * because a synthetic probe vector is meaningless to a cosine index — an
 * all-0.01 vector is not a point in the embedding space and Atlas correctly
 * rejects it.
 *
 * Run: npx tsx scripts/probe-vector-search.ts
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { applyDnsOverride } from "../server/src/lib/dns.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
    if (existsSync(resolve(ROOT, ".env"))) {
        const { config } = await import("dotenv");
        config({ path: resolve(ROOT, ".env") });
    }
    applyDnsOverride(process.env.DNS_SERVERS);

    const { pipeline, env } = await import("@huggingface/transformers");
    const { getObservations } = await import("../server/src/lib/data.js");
    const { keywordSearch } = await import("../server/src/lib/atlas.js");

    env.allowLocalModels = false;
    console.log("Loading EmbeddingGemma to build a real query vector...\n");
    const extractor = await pipeline(
        "feature-extraction",
        "onnx-community/embeddinggemma-300m-ONNX",
        { dtype: "q8", device: "cpu" },
    );

    const observations = getObservations();
    const sample = observations.find((o) => o.trail === "galiyat")!;

    // Deliberately query with a sentence that is NOT in the corpus, so a hit
    // proves semantic matching rather than an exact-match lookup.
    const query = "Rain overnight, stream running high, everything underfoot soggy";
    console.log(`QUERY: "${query}"`);
    console.log(`(not present in the corpus — proving semantic match, not lookup)\n`);

    const out = await extractor(query, { pooling: "mean", normalize: true });
    const vector = Array.from(out.data as Float32Array);
    console.log(`vector: ${vector.length} dimensions\n`);

    const client = new MongoClient(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const observationsCol = client
        .db(process.env.MONGO_DB ?? "khoj")
        .collection("observations");

    // With the trail filter, as the app does.
    const filtered = await observationsCol
        .aggregate([
            {
                $vectorSearch: {
                    index: "vector_index",
                    path: "embedding",
                    queryVector: vector,
                    numCandidates: 100,
                    limit: 4,
                    filter: { trail: "galiyat" },
                },
            },
            {
                $project: {
                    _id: 0,
                    date: 1,
                    field_note: 1,
                    outcome: 1,
                    score: { $meta: "vectorSearchScore" },
                },
            },
        ])
        .toArray();

    console.log("$vectorSearch with trail filter (what the app does):");
    for (const h of filtered) {
        console.log(
            `  ${(h as { score: number }).score.toFixed(4)}  ${(h as { date: string }).date}  ${
                (h as { field_note: string }).field_note.slice(0, 64)
            }`,
        );
    }

    // Without it, to show the filter field is doing real work.
    const unfiltered = await observationsCol
        .aggregate([
            {
                $vectorSearch: {
                    index: "vector_index",
                    path: "embedding",
                    queryVector: vector,
                    numCandidates: 100,
                    limit: 3,
                },
            },
            { $project: { _id: 0, date: 1, trail: 1, score: { $meta: "vectorSearchScore" } } },
        ])
        .toArray();

    console.log("\n$vectorSearch WITHOUT the trail filter (for comparison):");
    for (const h of unfiltered) {
        const d = h as { date: string; trail: string; score: number };
        console.log(`  ${d.score.toFixed(4)}  ${d.date}  ${d.trail}`);
    }

    console.log("\nkeywordSearch fallback for the same query:");
    for (const k of keywordSearch(observations, query, { trail: "galiyat", limit: 4 })) {
        console.log(`  ${k.similarity.toFixed(4)}  ${k.date}  ${k.trail}`);
    }

    await client.close();
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});