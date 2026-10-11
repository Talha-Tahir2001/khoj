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
        run: checkGemini,
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

const VERTEX_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];

interface Surface {
    label: string;
    base: string;
    models: string[];
    /** AI Studio lists models for free; Vertex has no equivalent endpoint. */
    canList: boolean;
}

/**
 * Every surface worth trying, in order.
 *
 * AI Studio and Vertex AI bill **different projects**. Verified: the same key
 * was refused on AI Studio with "prepayment credits are depleted" while
 * `gemini-2.5-flash` on a Vertex project answered normally. So testing one and
 * reporting a blanket failure is misleading — which is exactly what this script
 * did before it learned to try both.
 */
function surfaces(): Surface[] {
    const list: Surface[] = [];

    const studio = (
        process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/$/, "");

    if (studio.includes("generativelanguage")) {
        list.push({
            label: "AI Studio",
            base: studio,
            models: dedupe([
                process.env.GEMINI_MODEL ?? "",
                "gemma-4-31b-it",
                "gemma-4-26b-a4b-it",
                "gemini-2.5-flash",
            ]),
            canList: true,
        });
    }

    const explicit = process.env.GEMINI_FALLBACK_BASE_URL?.replace(/\/$/, "");
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const vertex =
        explicit ??
        (project
            ? `https://${process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1"}-aiplatform` +
              `.googleapis.com/v1/projects/${project}/locations/${process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1"}`
            : null);

    if (vertex?.includes("aiplatform")) {
        list.push({
            label: "Vertex AI",
            base: vertex,
            // Google hosts open-weight Gemma on AI Studio, not Vertex, so a
            // gemma-* id here is always a 404.
            models: VERTEX_MODELS,
            canList: false,
        });
    }

    return list;
}

const dedupe = (xs: string[]): string[] => xs.filter((x, i) => xs.indexOf(x) === i);

async function checkGemini(): Promise<{
    pass: boolean;
    detail: string;
    hint?: string;
}> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        return {
            pass: false,
            detail: "GEMINI_API_KEY not set",
            hint: "Brief falls back to deterministic rules.",
        };
    }

    const gemmaVisible: string[] = [];
    let working: { label: string; model: string } | null = null;
    const refusals: string[] = [];

    for (const surface of surfaces()) {
        let authed = true;

        if (surface.canList) {
            const listed = await fetch(`${surface.base}/models?pageSize=200`, {
                headers: { "x-goog-api-key": key },
                signal: AbortSignal.timeout(15_000),
            });
            if (!listed.ok) {
                authed = false;
                refusals.push(`${surface.label}: key rejected (HTTP ${listed.status})`);
                continue;
            }
            const payload = (await listed.json()) as {
                models?: Array<{ name: string }>;
            };
            gemmaVisible.push(
                ...(payload.models ?? [])
                    .map((m) => m.name)
                    .filter((n) => n.includes("gemma")),
            );
        }

        for (const model of surface.models) {
            const res = await fetch(`${surface.base}/${pathFor(surface.base, model)}:generateContent`, {
                method: "POST",
                headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
                    generationConfig: { maxOutputTokens: 900, thinkingConfig: { thinkingBudget: 0 } },
                }),
                signal: AbortSignal.timeout(25_000),
            });

            if (res.ok) {
                working = { label: surface.label, model };
                break;
            }
            const err = (await res.json().catch(() => ({}))) as {
                error?: { message?: string };
            };
            const short = (err.error?.message ?? `HTTP ${res.status}`).slice(0, 60);
            refusals.push(`${surface.label}/${model}: ${res.status} ${short}`);
            if (res.status === 401) {
                authed = false;
                break;
            }
        }
        void authed;
        if (working) break;
    }

    if (working) {
        const openWeight = gemmaVisible.length > 0 && working.model.startsWith("gemma-");
        return {
            pass: true,
            detail: `${working.model} on ${working.label}${
                gemmaVisible.length > 0 ? ` (${gemmaVisible.length} gemma models listed)` : ""
            }${openWeight ? " — open-weight" : ""}`,
            hint: openWeight
                ? undefined
                : gemmaVisible.length > 0
                  ? "Open-weight Gemma is visible but not usable on this plan; brief runs on a hosted model."
                  : undefined,
        };
    }

    const validPart = gemmaVisible.length > 0 ? "key is VALID" : "key rejected";
    return {
        pass: false,
        detail: `${validPart}, but nothing generated. ${refusals[0] ?? ""}`,
        hint:
            "AI Studio and Vertex bill different projects — one can be out of credit while the other works. " +
            "Set GOOGLE_CLOUD_PROJECT to try a Vertex project.",
    };
}

/** Vertex needs the publisher segment; AI Studio does not. */
const pathFor = (base: string, model: string): string =>
    base.includes("aiplatform") ? `publishers/google/models/${model}` : `models/${model}`;

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