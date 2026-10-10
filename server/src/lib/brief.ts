import type { ScoredDay, Trail } from "@khoj/shared/types";
import type { Config } from "./config.js";
import { hasGemma } from "./config.js";
import type { SimilarCondition } from "./atlas.js";
import { withChatSpan } from "./observability.js";
import type * as Sentry from "@sentry/node";

export interface BriefInput {
    trail: Trail;
    day: ScoredDay;
    similar: SimilarCondition[];
    live_reports: Array<{ title: string; snippet: string }>;
}

export interface Brief {
    text: string;
    source: "gemma" | "rule";
    audio_url?: string;
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
 * Produce the spoken brief.
 *
 * The model is GIVEN the score (FR4). If the key is missing or the call fails,
 * the rule fallback produces a brief from the same numbers — labelled `"rule"`
 * so the UI never presents a template as model output.
 */
export async function generateBrief(
    config: Config,
    input: BriefInput,
    parentSpan: Sentry.Span | null,
    conversationId: string,
): Promise<Brief> {
    if (!hasGemma(config)) return { text: ruleBrief(input), source: "rule" };

    try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
        const prompt = composePrompt(input);

        const { result } = await withChatSpan(
            parentSpan,
            {
                model: config.GEMINI_MODEL,
                conversationId,
                prompt,
                promptPreview: input.day.date,
            },
            () =>
                ai.models.generateContent({
                    model: config.GEMINI_MODEL,
                    contents: prompt,
                    config: {
                        systemInstruction: SYSTEM_PROMPT,
                        maxOutputTokens: 200,
                        temperature: 0.6,
                        abortSignal: AbortSignal.timeout(config.GEMINI_TIMEOUT_MS),
                    },
                }),
        );

        const text = result.text?.trim();
        if (!text) return { text: ruleBrief(input), source: "rule" };
        return { text: trimToSentences(text, 3), source: "gemma" };
    } catch {
        return { text: ruleBrief(input), source: "rule" };
    }
}

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
    sentences.push(`High of ${Math.round(day.tmax_c)}°C with wind to ${Math.round(day.wind_max_kmh)} km/h.`);

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