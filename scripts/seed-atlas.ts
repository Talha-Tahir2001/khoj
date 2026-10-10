/**
 * Seed the Atlas vector index.
 *
 * Two jobs:
 *   1. Create the TTL index on the cache collection.
 *   2. Embed every observation and upsert it into `observations` with its vector.
 *
 * The embeddings must be produced by the SAME model the browser runs, or the
 * vectors will not live in the same space and every query will return noise.
 * This script therefore runs EmbeddingGemma through Transformers.js on Node,
 * using the identical model id and pooling as client/src/embed.ts.
 *
 * Usage:
 *   MONGO_URI=... npx tsx scripts/seed-atlas.ts
 *
 * It is idempotent — safe to re-run after adding observations.
 */

import "dotenv/config";
import { MongoClient } from "mongodb";
import { pipeline, env } from "@huggingface/transformers";
import { applyDnsOverride } from "../server/src/lib/dns.js";
import type { ConditionObservation } from "../shared/src/types.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Opt-in DNS override, same as the server. See server/src/lib/dns.ts — without
 * it this script dies with `querySrv ETIMEOUT` on the same networks where the
 * API does.
 */
applyDnsOverride(process.env.DNS_SERVERS);

const MODEL_ID = process.env.EMBEDDING_MODEL ?? "onnx-community/embeddinggemma-300m-ONNX";
const EMBEDDING_DIMENSIONS = 768;
const DB_NAME = process.env.MONGO_DB ?? "khoj";

const DATA_FILE = resolve(import.meta.dirname, "../data/conditions.json");

async function main() {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error("MONGO_URI is not set. Nothing to do.");
        process.exit(1);
    }

    const observations = JSON.parse(readFileSync(DATA_FILE, "utf8")) as ConditionObservation[];
    console.log(`Loaded ${observations.length} observations from data/conditions.json`);

    // ── Embed ──────────────────────────────────────────────────────────
    env.allowLocalModels = false;
    console.log(`Loading ${MODEL_ID}...`);
    const extractor = await pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
        device: "cpu",
    });

    const docs: Array<ConditionObservation & { embedding: number[] }> = [];
    for (const o of observations) {
        const out = await extractor(o.conditions_text, {
            pooling: "mean",
            normalize: true,
        });
        const vector = Array.from(out.data as Float32Array);

        if (vector.length !== EMBEDDING_DIMENSIONS) {
            // A wrong length here fails at insert time in Atlas, with a much
            // less useful message than this one.
            console.error(
                `  ${o._id}: got ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}.`,
            );
            console.error(
                "  The Atlas vector index dimension must match. Do not create it until this passes.",
            );
            process.exit(1);
        }

        docs.push({ ...o, embedding: vector });
        console.log(`  embedded ${o._id}`);
    }

    // ── Connect ────────────────────────────────────────────────────────
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    const db = client.db(DB_NAME);

    // ── Cache TTL index ────────────────────────────────────────────────
    await db.collection("cache").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
    console.log("Cache TTL index ensured on cache.expires_at");

    // ── Observations ───────────────────────────────────────────────────
    const observationsCol = db.collection<ConditionObservation>("observations");
    await observationsCol.createIndex({ trail: 1 });

    const ops = docs.map((d) => ({
        replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true },
    }));
    const result = await observationsCol.bulkWrite(ops, { ordered: false });
    console.log(
        `Upserted ${result.upsertedCount + result.modifiedCount} observations into ${DB_NAME}.observations`,
    );

    // ── Vector index ───────────────────────────────────────────────────
    // The index definition must match the emitted dimension exactly. If it
    // already exists with a different numDimensions it has to be dropped first.
    const existing = await db.collection("observations").listIndexes().toArray();
    const vectorIndex = existing.find((i) => i.name === "vector_index");

    if (vectorIndex && "numDimensions" in vectorIndex && vectorIndex.numDimensions !== EMBEDDING_DIMENSIONS) {
        console.error(
            `Existing vector_index has numDimensions=${String(vectorIndex.numDimensions)}, but the model emits ${EMBEDDING_DIMENSIONS}.`,
        );
        console.error("Drop it in Atlas, then re-run: db.observations.dropIndex('vector_index')");
        await client.close();
        process.exit(1);
    }

    try {
        // Atlas's vector index definition is not yet in the driver's
        // IndexSpecification type, so it is cast at the call site rather than
        // spreading `as never` over the whole options object and losing real
        // type checking on the keys.
        await db.collection("observations").createIndex(
            { embedding: "vector" } as never,
            {
                name: "vector_index",
                type: "vectorSearch",
                definition: "vectorSearch",
                vectorSearch: {
                    numDimensions: EMBEDDING_DIMENSIONS,
                    path: "embedding",
                    similarity: "cosine",
                    numCandidates: 100,
                },
            } as never,
        );
        console.log(`vector_index created with numDimensions=${EMBEDDING_DIMENSIONS}, cosine`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // This one is not a code bug and the raw driver error says nothing
        // actionable, so translate it.
        if (message.includes("Unknown index plugin 'vector'")) {
            console.error(`
The observations were written successfully — only the vector INDEX failed.

"Unknown index plugin 'vector'" means this cluster will not create an Atlas
vector index from the driver. Two usual causes:

  1. The database user lacks the role to create indexes.
     → Atlas → Database Access → edit your user → add "Read Write" on the
       cluster, or "Cluster Manager".
  2. Atlas Search is not enabled on this cluster (common on M0).
     → Atlas → Search → Create Search Index → choose "Vector Search"
       → database "khoj", collection "observations", path "embedding",
       numDimensions ${EMBEDDING_DIMENSIONS}, similarity cosine.
     Creating it in the UI takes about 30 seconds and needs no role change.

Until the index exists, retrieval falls back to keyword search. The app is
fully functional — it just cannot match phrasing semantically.
`);
        } else {
            console.error(`Vector index creation failed: ${message}`);
        }

        await client.close();
        process.exit(1);
    }

    await client.close();
    console.log("Done.");
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});