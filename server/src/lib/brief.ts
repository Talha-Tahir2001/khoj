import type { ScoredDay, Trail } from "@khoj/shared/types";
import type { Config } from "./config.js";
import { hasGemma } from "./config.js";
import { noteOk, noteStatusFailure, reasonFor, shouldTry } from "./upstream.js";
import type { SimilarCondition } from "./atlas.js";
import type * as Sentry from "@sentry/node";

export interface BriefInput {
    trail: Trail;
    day: ScoredDay;
    similar: SimilarCondition[];
    live_reports: Array<{ title: string; snippet: string }>;
}

export interface Brief {
    text: string;
    source: "gemma" | "gemini" | "rule";
    model?: string;
    /** Why the brief is rule-based, when it is. */
    reason?: string | null;
}

const SYSTEM_PROMPT = [
    "You write hiking conditions briefs for trails in northern Pakistan.",
    "You are given a score that has ALREADY been computed by deterministic rules.",
    "You must never compute, adjust, contradict, or invent a score.",
    "You must never invent weather data, observations, or trail conditions.",
    "Speak plainly, like a friend who has hiked the trail. No meteorology jargon.",
    "Exactly three sentences. No headings, no lists, no bullet points, no emoji.",
].join(" ");

/**
 * Model candidates, in order.
 *
 * AI Studio serves the open-weight `gemma-*` ids; Vertex AI does not — it only
 * offers hosted Gemini. So the two endpoints need different model lists, and
 * trying a Gemma id against Vertex just returns a 404.
 *
 * Ordering matters for the challenge claim: an open-weight Gemma id is the same
 * family as the EmbeddingGemma running client-side, whereas `gemini-*` is a
 * hosted model wearing the name. Gemma is preferred wherever it is reachable,
 * but a working brief beats an honest one about a model that is not available.
 */
const AI_STUDIO_MODELS = ["gemma-4-31b-it", "gemma-4-26b-a4b-it", "gemini-2.5-flash"];
const VERTEX_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];

/** Shape of the subset of the Gemini REST response we rely on. */
interface GeminiResponse {
    candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
        finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; status?: string };
}

interface Target {
    baseUrl: string;
    modelId: string;
    /** Fully-qualified model path, including the publisher segment. */
    modelPath: string;
    /** Human label for logs. */
    surface: "ai-studio" | "vertex";
}

/**
 * AI Studio and Vertex build the model path differently, and the difference is
 * easy to miss because AI Studio's version is just `models/<id>`:
 *
 *   AI Studio  <base>/models/<id>
 *   Vertex     <base>/publishers/google/models/<id>
 *
 * Getting this wrong returns a clean 404 that reads like "model unavailable",
 * which is exactly what a plan restriction looks like. It cost one confusing
 * round of debugging here.
 */
function modelPathFor(baseUrl: string, modelId: string): string {
    return baseUrl.includes("aiplatform")
        ? `publishers/google/models/${modelId}`
        : `models/${modelId}`;
}

class GeminiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

/**
 * Every endpoint/model combination worth trying, best first.
 *
 * Vertex AI and AI Studio bill **different projects**. A 402 from one says
 * nothing about the other — verified: this key was refused on AI Studio with
 * "prepayment credits are depleted" while `gemini-2.5-flash` on a Vertex
 * project answered normally.
 *
 * So rather than making someone work out which surface has quota, try them in
 * turn and stop at the first that works.
 */
function targets(config: Config): Target[] {
    const list: Target[] = [];

    const push = (baseUrl: string, modelIds: string[]) => {
        const base = baseUrl.replace(/\/$/, "");
        const surface = base.includes("aiplatform") ? "vertex" : "ai-studio";
        for (const modelId of dedupe(modelIds)) {
            list.push({ baseUrl: base, modelId, modelPath: modelPathFor(base, modelId), surface });
        }
    };

    if (config.GEMINI_BASE_URL.includes("generativelanguage")) {
        // A Gemma id belongs here; a Gemini id is the fallback for a plan that
        // does not expose the open-weight models.
        push(config.GEMINI_BASE_URL, [config.GEMINI_MODEL, ...AI_STUDIO_MODELS]);
    }

    if (config.GEMINI_FALLBACK_BASE_URL) {
        const isVertex = config.GEMINI_FALLBACK_BASE_URL.includes("aiplatform");
        push(config.GEMINI_FALLBACK_BASE_URL, [
            config.GEMINI_MODEL,
            ...(isVertex ? VERTEX_MODELS : AI_STUDIO_MODELS),
        ]);
    } else if (config.GOOGLE_CLOUD_PROJECT) {
        const { GOOGLE_CLOUD_PROJECT: project, GOOGLE_CLOUD_LOCATION: location } = config;
        push(
            `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}`,
            VERTEX_MODELS,
        );
    }

    // Never send a Gemma id to Vertex: Google hosts open-weight Gemma on AI
    // Studio only, so it is always a 404 there and just burns the timeout.
    return dedupeTargets(list).filter((t) =>
        t.surface === "vertex" ? VERTEX_MODELS.includes(t.modelId) : true,
    );
}

const dedupe = (xs: string[]): string[] => xs.filter((x, i) => x && xs.indexOf(x) === i);

function dedupeTargets(xs: Target[]): Target[] {
    const seen = new Set<string>();
    return xs.filter((t) => {
        const k = `${t.baseUrl}|${t.modelId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * Produce the spoken brief.
 *
 * Called directly over REST rather than through @google/genai, for three
 * reasons that all showed up in practice:
 *
 *  1. **The SDK retries silently.** It turned a 1.2 s billing rejection into a
 *     3 s wait, and the brief is the largest single contributor to response
 *     time after weather. A plan or quota failure is deterministic; asking
 *     twice cannot change the answer.
 *  2. **Explicit timeout.** One AbortSignal we control, rather than a per-retry
 *     timeout the SDK composes on our behalf.
 *  3. **A configurable base URL.** Vertex AI and AI Studio are different
 *     endpoints with different auth shapes. One env var covers both, and
 *     anything in front of them.
 *
 * If the key is missing or the call fails, the rule fallback produces a brief
 * from the same numbers — labelled so the UI never presents a template as model
 * output.
 */
export async function generateBrief(
    config: Config,
    input: BriefInput,
    parentSpan: Sentry.Span | null,
    conversationId: string,
): Promise<Brief> {
    if (!hasGemma(config) || !shouldTry("gemma")) {
        return {
            text: ruleBrief(input),
            source: "rule",
            reason: briefUnavailableReason() ?? "Briefing model not configured.",
        };
    }

    const prompt = composePrompt(input);
    let lastStatus = 0;
    let lastMessage = "";

    for (const target of targets(config)) {
        try {
            const raw = await callGemini(config, target, prompt);
            const text = trimToSentences(raw, 3);

            /**
             * Reject a truncated or degenerate response.
             *
             * A model that runs out of token budget mid-sentence returns a
             * fragment with no terminator. Presenting that as the brief looks
             * like the app is broken, and it is strictly worse than the
             * rule-based fallback — which at least always reads as a
             * complete sentence. Observed with reasoning enabled at a 200-token
             * budget: "Babusar is a solid go for".
             */
            if (text.length < 40 || !/[.!?]$/.test(text)) {
                lastStatus = 502;
                lastMessage = `${target.modelId} returned a truncated brief (${text.length} chars)`;
                continue;
            }

            console.log(`[khoj] brief written by ${target.modelId} on ${target.surface}`);
            return {
                text,
                source: target.modelId.startsWith("gemma-") ? "gemma" : "gemini",
                model: target.modelId,
                reason: null,
            };
        } catch (err) {
            lastStatus = err instanceof GeminiError ? err.status : 0;
            lastMessage = err instanceof Error ? err.message : String(err);
        }
    }

    const reason = classify(lastStatus, lastMessage);
    noteStatusFailure("gemma", lastStatus, reason);

    return { text: ruleBrief(input), source: "rule", reason };
}

/**
 * The brief should say which model actually wrote it, in plain language.
 *
 * The distinction matters for the challenge: an open-weight `gemma-*` id is a
 * materially stronger claim than `gemini-*`, and the response should not blur
 * the two.
 */

/**
 * One REST call.
 *
 * Uses `x-goog-api-key` rather than `?key=` so the credential does not end up
 * in a URL, an access log, or a referrer header.
 */
async function callGemini(
    config: Config,
    target: Target,
    prompt: string,
): Promise<string> {
    const url = `${target.baseUrl}/${target.modelPath}:generateContent`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "x-goog-api-key": config.GEMINI_API_KEY!,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.6,
                // Generous, because reasoning tokens are drawn from this budget
                // and the model defaults to thinking on. At 200 the output
                // arrived as a truncated fragment — "Babusar is a solid go for"
                // — which is worse than no brief at all.
                maxOutputTokens: 900,
                // A three-sentence trail brief is not a reasoning task, and
                // reasoning spends latency that a car-park user does not have.
                thinkingConfig: { thinkingBudget: 0 },
            },
        }),
        signal: AbortSignal.timeout(config.GEMINI_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

    if (!response.ok) {
        throw new GeminiError(
            response.status,
            payload.error?.message ?? `HTTP ${response.status}`,
        );
    }

    const blocked = payload.promptFeedback?.blockReason;
    if (blocked) {
        throw new GeminiError(422, `refused the prompt (blockReason: ${blocked})`);
    }

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
        // Gemma 4 emits reasoning parts flagged `thought: true`. Those are not
        // the answer, and concatenating them would put reasoning prose in front
        // of the user.
        .filter((part) => part.thought !== true)
        .map((part) => part.text ?? "")
        .join("")
        .trim();

    if (!text) {
        throw new GeminiError(
            502,
            `no text returned (finishReason: ${payload.candidates?.[0]?.finishReason ?? "unknown"})`,
        );
    }

    return text;
}

/**
 * Turn an HTTP status into a sentence a user can act on.
 *
 * A bare "brief failed" is undiagnosable. Billing, permissions, a bad model id
 * and a network blip each need a completely different response.
 */
function classify(status: number, message = ""): string {
    switch (status) {
        case 401:
            return "Gemini rejected the API key.";
        case 402:
            return "Gemini API credits are exhausted — the brief falls back to rules.";
        case 403:
            return "Gemini denied access to this model on this key.";
        case 404:
            return "The configured model is not available on this key.";
        case 422:
            return "The briefing model refused the request.";
        default:
            return status === 0
                ? "The briefing model is unreachable right now."
                : `The briefing model returned HTTP ${status}${message ? ` — ${message}` : ""}.`;
    }
}

/** Why the brief is rule-based, when it is. */
export const briefUnavailableReason = (): string | undefined => reasonFor("gemma");

function composePrompt({ trail, day, similar, live_reports }: BriefInput): string {
    const lines: string[] = [];

    lines.push(`Trail: ${trail.name} (${trail.elevation_m} m, ${trail.difficulty}).`);
    lines.push(`Date: ${day.date}`);
    lines.push("");
    lines.push(`Score (already computed, do not recalculate): ${day.score}/100 — ${day.band}.`);

    lines.push("");
    lines.push("Weather as forecast:");
    lines.push(`- High ${day.tmax_c}°C, low ${day.tmin_c}°C`);
    lines.push(`- Rain ${day.precip_mm} mm, snow ${day.snow_cm} cm`);
    lines.push(`- Max wind ${day.wind_max_kmh} km/h`);
    lines.push(`- Daylight ${(day.daylight_seconds / 3600).toFixed(1)} hours`);

    if (day.penalties.length > 0) {
        lines.push("");
        lines.push("Penalties already applied (mention at most two, by name):");
        for (const p of day.penalties) {
            lines.push(`- ${p.label}: −${p.points} (${p.detail})`);
        }
    }

    if (similar.length > 0) {
        lines.push("");
        lines.push("Past days on this trail with similar conditions:");
        for (const s of similar.slice(0, 2)) {
            lines.push(`- ${s.date} (${s.outcome}): ${s.field_note}`);
        }
    }

    if (live_reports.length > 0) {
        lines.push("");
        lines.push("Recent web mentions:");
        for (const r of live_reports.slice(0, 2)) {
            lines.push(`- ${r.title}: ${r.snippet.slice(0, 140)}`);
        }
    }

    lines.push("");
    lines.push("Write the three-sentence brief.");

    return lines.join("\n");
}

/** Keep it to three sentences. A brief that runs long is a brief nobody hears. */
export function trimToSentences(text: string, max: number): string {
    const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g);
    if (!parts) return text.trim();
    return parts.slice(0, max).join("").trim();
}

/**
 * The fallback brief. Reads the same numbers the score came from, so it can
 * never contradict the verdict. Tagged `"rule"` everywhere it surfaces.
 *
 * Order matters: the three-sentence limit is hard, so the score goes in the
 * first sentence rather than being the one that gets truncated away.
 */
export function ruleBrief({ trail, day, similar }: BriefInput): string {
    const sentences: string[] = [];

    // 1. The verdict, with the score and the worst penalty — if there is one.
    const worst = [...day.penalties].sort((a, b) => b.points - a.points)[0];
    if (day.band === "NO") {
        sentences.push(
            worst
                ? `Do not drive to ${trail.name} — ${day.score} out of 100, with ${day.penalties.length} ${day.penalties.length === 1 ? "problem" : "problems"} against it.`
                : `Do not drive to ${trail.name} — ${day.score} out of 100.`,
        );
    } else if (worst) {
        sentences.push(
            `${day.band === "GO" ? "Good" : "Marginal"} day on ${trail.name} at ${day.score} out of 100, with ${worst.label.toLowerCase()} costing ${worst.points} points${worst.detail ? ` — ${worst.detail}` : ""}.`,
        );
    } else {
        sentences.push(
            `${day.band === "GO" ? "Good" : "Marginal"} day on ${trail.name} at ${day.score} out of 100 — nothing in the forecast penalises it.`,
        );
    }

    // 2. The conditions, always. These are the numbers the score was built from.
    sentences.push(
        `High of ${Math.round(day.tmax_c)}°C with wind to ${Math.round(day.wind_max_kmh)} km/h.`,
    );

    // 3. The real-world comparison, when retrieval found one.
    if (similar.length > 0) {
        const { date, field_note } = similar[0]!;
        sentences.push(`On ${formatShortDate(date)} a comparable day: ${field_note}`);
    } else {
        sentences.push("No past observations on this trail were similar enough to compare against.");
    }

    return trimToSentences(sentences.join(" "), 3);
}

function formatShortDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}