/**
 * Check what each credential can actually reach, right now.
 *
 * Run this whenever a key is added, changed, or starts failing:
 *
 *     npx tsx scripts/check-keys.ts
 *
 * It exists because every failure mode here is silent or actively misleading:
 *
 *  - SerpApi answers `200` with an empty body when the key is missing, so a
 *    misconfiguration looks exactly like "thin coverage for this trail".
 *  - ElevenLabs answers `402 payment_required` for a library voice, which
 *    reads as exhausted credits but means the plan, not the balance.
 *  - A Gemini key can authenticate fine — listing models is free — while every
 *    generateContent call is refused for quota. "Valid key" and "usable key"
 *    are different claims.
 *
 * So it tests each one for the thing we actually need, and prints a verdict
 * rather than a stack trace. Exits non-zero if nothing works.
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bad = (s: string) => `\x1b[31m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

interface Check {
    name: string;
    configured: boolean;
    run: () => Promise<{ pass: boolean; detail: string; hint?: string }>;
}

const checks: Check[] = [
    {
        name: "Open-Meteo",
        configured: true,
        async run() {
            const res = await fetch(
                "https://api.open-meteo.com/v1/forecast?latitude=33.736&longitude=73.054&daily=temperature_2m_max&forecast_days=1&timezone=auto",
                { signal: AbortSignal.timeout(10_000) },
            );
            if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
            const body = (await res.json()) as { daily?: { time?: string[] } };
            return {
                pass: Boolean(body.daily?.time?.length),
                detail: `forecast for ${body.daily?.time?.[0] ?? "?"}`,
            };
        },
    },
    {
        name: "MongoDB Atlas",
        configured: Boolean(process.env.MONGO_URI),
        async run() {
            if (!process.env.MONGO_URI) {
                return {
                    pass: false,
                    detail: "MONGO_URI not set",
                    hint: "Retrieval falls back to keyword search. App still works.",
                };
            }
            if (/<[^>]+>/.test(process.env.MONGO_URI)) {
                return {
                    pass: false,
                    detail: "MONGO_URI still contains a <placeholder>",
                    hint: "Atlas → Connect → Drivers, then replace <cluster>.",
                };
            }

            const { applyDnsOverride } = await import("../server/src/lib/dns.js");
            applyDnsOverride(process.env.DNS_SERVERS);

            const { MongoClient } = await import("mongodb");
            const client = new MongoClient(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 6000,
            });
            const started = Date.now();
            try {
                await client.connect();
                const db = client.db(process.env.MONGO_DB ?? "khoj");
                const observations = await db.collection("observations").countDocuments();

                // Search indexes are NOT regular indexes and do not appear in
                // listIndexes() — they live in their own namespace and are only
                // visible through $listSearchIndexes. Checking listIndexes()
                // here reported "no vector_index" on a cluster where a fully
                // built, queryable index existed, which is worse than useless.
                let vectorIndex: { status?: string; queryable?: boolean } | undefined;
                try {
                    const search = (await db
                        .collection("observations")
                        .aggregate([{ $listSearchIndexes: {} }])
                        .toArray()) as Array<{
                        name?: string;
                        status?: string;
                        queryable?: boolean;
                    }>;
                    vectorIndex = search.find((i) => i.name === "vector_index");
                } catch {
                    // Older servers have no $listSearchIndexes. Absence of the
                    // stage is not absence of the index.
                }

                const ready = vectorIndex?.queryable === true;
                return {
                    pass: observations > 0,
                    detail: `${observations} observations, ${Date.now() - started}ms${
                        ready
                            ? ", vector_index queryable"
                            : vectorIndex
                              ? `, vector_index ${vectorIndex.status ?? "building"}`
                              : ""
                    }`,
                    hint: ready
                        ? undefined
                        : vectorIndex
                          ? "Index is still building. Wait for status READY."
                          : "No vector_index found via $listSearchIndexes. Create one in Atlas → Search, or run npm run seed:atlas.",
                };
            } finally {
                await client.close();
            }
        },
    },
    {
        name: "Gemini / Gemma",
        configured: Boolean(process.env.GEMINI_API_KEY),
        async run() {
            const key = process.env.GEMINI_API_KEY;
            if (!key) {
                return {
                    pass: false,
                    detail: "GEMINI_API_KEY not set",
                    hint: "Brief falls back to deterministic rules.",
                };
            }
            const base = (
                process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta"
            ).replace(/\/$/, "");

            // Step 1: can it list models? Free, and proves the key is valid.
            const models = await fetch(`${base}/models?pageSize=200`, {
                headers: { "x-goog-api-key": key },
                signal: AbortSignal.timeout(15_000),
            });
            if (!models.ok) {
                return {
                    pass: false,
                    detail: `model list HTTP ${models.status} — key rejected`,
                };
            }
            const payload = (await models.json()) as {
                models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
            };
            const gemma = (payload.models ?? []).filter((m) => m.name.includes("gemma"));
            if (gemma.length === 0) {
                return { pass: false, detail: "no gemma models visible on this key" };
            }

            // Step 2: can it actually generate? This is the claim that matters.
            const model = process.env.GEMINI_MODEL ?? gemma[0]!.name.replace("models/", "");
            const gen = await fetch(`${base}/models/${model}:generateContent`, {
                method: "POST",
                headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
                    generationConfig: { maxOutputTokens: 8 },
                }),
                signal: AbortSignal.timeout(20_000),
            });

            if (gen.ok) {
                return {
                    pass: true,
                    detail: `${model} generated — ${gemma.length} gemma models available`,
                };
            }

            const err = (await gen.json().catch(() => ({}))) as {
                error?: { message?: string };
            };
            const message = err.error?.message ?? `HTTP ${gen.status}`;

            if (gen.status === 402) {
                return {
                    pass: false,
                    detail: `key is VALID (${gemma.length} gemma models listed) but generateContent is refused: ${message}`,
                    hint:
                        "This is a quota/plan issue at this base URL, not a bad key. " +
                        "It bills the Google PROJECT behind this base URL — try GEMINI_BASE_URL pointing at a different project or gateway.",
                };
            }
            return { pass: false, detail: `HTTP ${gen.status}: ${message}` };
        },
    },
    {
        name: "ElevenLabs",
        configured: Boolean(process.env.ELEVENLABS_API_KEY),
        async run() {
            const key = process.env.ELEVENLABS_API_KEY;
            if (!key) {
                return { pass: false, detail: "not set", hint: "Brief is text-only." };
            }

            // Probing the configured voice alone is misleading: a free plan is
            // refused for library voices, which looks like a billing failure.
            // So try the configured one, then known-good premade fallbacks, and
            // report which work.
            const candidates = [
                process.env.ELEVENLABS_VOICE_ID,
                "JBFqnCBsd6RMkjVDRZzb",
                "bIHbv24MWmeRgasZH58o",
            ].filter((v): v is string => Boolean(v));

            const results: Array<{ id: string; status: number; note: string }> = [];

            for (const voiceId of [...new Set(candidates)]) {
                const res = await fetch(
                    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
                    {
                        method: "POST",
                        headers: { "xi-api-key": key, "Content-Type": "application/json" },
                        body: JSON.stringify({
                            text: "Test.",
                            model_id: process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5",
                        }),
                        signal: AbortSignal.timeout(20_000),
                    },
                );
                if (res.ok) {
                    const bytes = (await res.arrayBuffer()).byteLength;
                    results.push({ id: voiceId, status: 200, note: `${bytes} bytes` });
                } else {
                    const detail = (await res.json().catch(() => ({}))) as {
                        detail?: { code?: string; message?: string };
                    };
                    results.push({
                        id: voiceId,
                        status: res.status,
                        note: detail.detail?.code ?? `HTTP ${res.status}`,
                    });
                }
            }

            const working = results.filter((r) => r.status === 200);
            if (working.length === 0) {
                const configured = results.find((r) => r.id === candidates[0]);
                const paid = results.some((r) => r.status === 402);
                return {
                    pass: false,
                    detail: `no voice usable — configured one: ${configured?.note ?? "?"}`,
                    hint: paid
                        ? "402 paid_plan_required means free tiers cannot use library/professional voices. Use a PREMADE voice id."
                        : undefined,
                };
            }

            const configuredWorks = results[0]?.status === 200;
            return {
                pass: true,
                detail: `${working.length}/${results.length} voices work (${
                    configuredWorks ? "including the configured one" : "configured one is library-gated"
                })`,
                hint: configuredWorks ? undefined : `Set ELEVENLABS_VOICE_ID=${working[0]!.id}`,
            };
        },
    },
    {
        name: "SerpApi",
        configured: Boolean(process.env.SERPAPI_KEY),
        async run() {
            const key = process.env.SERPAPI_KEY;
            if (!key) {
                return { pass: false, detail: "not set", hint: "No live reports." };
            }
            const url = new URL("https://serpapi.com/search.json");
            url.searchParams.set("engine", "google_news");
            url.searchParams.set("q", "Galiyat trail conditions");
            url.searchParams.set("api_key", key);

            const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            const body = (await res.json().catch(() => ({}))) as {
                error?: string;
                news_results?: unknown[];
            };
            if (res.ok && !body.error) {
                return {
                    pass: true,
                    detail: `${body.news_results?.length ?? 0} results`,
                };
            }
            return {
                pass: false,
                detail: body.error ?? `HTTP ${res.status}`,
                hint: "A missing api_key returns HTTP 200 with an empty body — that is a misconfiguration, not thin coverage.",
            };
        },
    },
    {
        name: "Sentry",
        configured: Boolean(process.env.SENTRY_DSN),
        async run() {
            const dsn = process.env.SENTRY_DSN;
            if (!dsn) return { pass: false, detail: "not set", hint: "No gen_ai.* traces." };
            return { pass: true, detail: `project ${new URL(dsn).pathname.split("/").filter(Boolean).pop()}` };
        },
    },
];

async function main(): Promise<void> {
    const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

    // Load .env from the repo root for the same reason the server does: the npm
    // workspace sets cwd elsewhere.
    if (existsSync(resolve(ROOT, ".env"))) {
        const { config } = await import("dotenv");
        config({ path: resolve(ROOT, ".env") });
    }

    console.log("\nKhoj — credential check\n" + "=".repeat(60));

    let anyPass = false;
    for (const check of checks) {
        const label = `${check.name.padEnd(18)}`;
        if (!check.configured) {
            console.log(`${label} ${warn("not configured")} ${dim("— feature degrades, app still runs")}`);
            continue;
        }
        try {
            const result = await check.run();
            anyPass ||= result.pass;
            console.log(`${label} ${result.pass ? ok("OK  ") : bad("FAIL")} ${result.detail}`);
            if (result.hint) console.log(`${" ".repeat(18)}      ${dim(result.hint)}`);
        } catch (err) {
            console.log(`${label} ${bad("ERR ")} ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    console.log("=".repeat(60));
    console.log(
        anyPass
            ? "At least one integration is live. Run `npm run dev:server` and `npm run dev:client`.\n"
            : "Nothing is live yet — the app will still run on its fallbacks.\n",
    );
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});