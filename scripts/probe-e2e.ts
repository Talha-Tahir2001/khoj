/**
 * End-to-end check: does the running API actually use `$vectorSearch`?
 *
 * Embeds a sentence that is NOT in the corpus, sends it exactly as the browser
 * would, and reports which retrieval path answered.
 *
 * Run: npx tsx scripts/probe-e2e.ts
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.PROBE_API ?? "http://localhost:3000";

/** Mirrors client/src/embed.ts encodeVector exactly. */
function encodeVector(vector: number[]): string {
    const bytes = new Uint8Array(vector.length * 4);
    const view = new DataView(bytes.buffer);
    vector.forEach((v, i) => view.setFloat32(i * 4, v, true));
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

async function main(): Promise<void> {
    if (existsSync(resolve(ROOT, ".env"))) {
        const { config } = await import("dotenv");
        config({ path: resolve(ROOT, ".env") });
    }

    const { pipeline, env } = await import("@huggingface/transformers");
    // The server's mirror of conditionsText/focalDay — client/src/embed.ts
    // reads import.meta.env, which only exists under Vite.
    const { conditionsText, focalDay } = await import("../server/src/lib/conditions.js");

    env.allowLocalModels = false;
    const extractor = await pipeline("feature-extraction", "onnx-community/embeddinggemma-300m-ONNX", {
        dtype: "q8",
        device: "cpu",
    });

    for (const trail of ["galiyat", "babusar", "daman-e-koh"]) {
        const url = `${API}/api/advice?trail=${trail}&days=7`;
        const plain = (await (await fetch(url)).json()) as {
            days: Parameters<typeof conditionsText>[0][];
            similar_conditions: Array<{ date: string; similarity: number; field_note: string }>;
            meta: { reasons?: Record<string, string> };
        };

        // Embed the focal day's own text, exactly as the browser does.
        const focus = focalDay(plain.days);
        if (!focus) continue;
        const out = await extractor(conditionsText(focus), { pooling: "mean", normalize: true });
        const vector = Array.from(out.data as Float32Array);
        const encoded = encodeVector(vector);

        const res = await fetch(`${url}&embedding=${encodeURIComponent(encoded)}`);
        if (!res.ok) {
            console.log(`\n${trail}  API returned ${res.status}: ${await res.text()}`);
            continue;
        }
        const withVector = (await res.json()) as {
            similar_conditions: Array<{ date: string; similarity: number; field_note: string }>;
            meta: { reasons?: Record<string, string> };
        };

        const servedByAtlas = !withVector.meta.reasons?.retrieval;

        console.log(`\n${trail}  (${vector.length} dims, ${encoded.length} base64 chars)`);
        console.log(`  retrieval path: ${servedByAtlas ? "ATLAS $vectorSearch" : "KEYWORD fallback"}`);
        for (const s of withVector.similar_conditions.slice(0, 3)) {
            console.log(`    ${s.similarity.toFixed(4)}  ${s.date}  ${s.field_note.slice(0, 58)}`);
        }
        if (!servedByAtlas) {
            console.log(`    reason: ${withVector.meta.reasons?.retrieval}`);
        }
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});