import type { Config } from "./config.js";
import { hasElevenLabs } from "./config.js";
import { noteOk, noteStatusFailure, reasonFor, shouldTry } from "./upstream.js";

/**
 * Upper bound on speech synthesis.
 *
 * Deliberately short, and retries are off. The SDK's own retry policy stacked a
 * second full timeout on top of the first, which turned a 660 ms rejection into
 * a 17 s stall — and that stall was the single largest contributor to response
 * time. Audio is polish; the text brief is the feature.
 */
const VOICE_TIMEOUT_MS = 5000;

/**
 * How many candidate voices to probe before giving up.
 *
 * Three is enough: this account's first three library voices were all gated,
 * and the fourth worked.
 */
const PROBE_LIMIT = 4;

/**
 * Fallback candidates, tried in order when the configured voice is refused.
 *
 * Worth recording *why* this list exists, because the failure is deeply
 * misleading: a free ElevenLabs plan cannot use **library voices** over the API
 * at all, and it reports that as
 *
 *     402 paid_plan_required
 *     "Free users cannot use library voices via the API."
 *
 * which reads exactly like exhausted credits and is not. Several of these voice
 * IDs are however reachable on a free tier, and the app finds one itself rather
 * than making you diagnose your own account.
 */
const FALLBACK_VOICE_IDS = [
    "bIHbv24MWmeRgasZH58o", // Will — Relaxed Optimist
    "EXAVITQu4vr4xnSDxMaL", // Sarah — Mature, Reassuring
    "pNInz6obpgDQGcFmaJgB", // Adam — Dominant, Firm
    "jBqdMUZWMYHZHUpQvB9L", // Sara — Calm, Narrator
];

let resolvedVoiceId: string | null = null;

/** Clear the memoised voice. Test seam. */
export function resetVoice(): void {
    resolvedVoiceId = null;
}

/**
 * Pick a voice the current plan can actually use.
 *
 * Tries the configured voice first, then probes known-good fallbacks. The result
 * is memoised for the process, so this costs one request at most per voice
 * rather than one per synthesis.
 */
async function resolveVoice(config: Config): Promise<string | null> {
    if (resolvedVoiceId) return resolvedVoiceId;
    if (!shouldTry("elevenlabs")) return null;

    const candidates = [config.ELEVENLABS_VOICE_ID, ...FALLBACK_VOICE_IDS]
        .filter((id, i, all) => id && all.indexOf(id) === i)
        .slice(0, PROBE_LIMIT);

    for (const voiceId of candidates) {
        const result = await synthesize(config, voiceId, "test");
        if (result) {
            if (voiceId !== config.ELEVENLABS_VOICE_ID) {
                console.log(
                    `[khoj] ElevenLabs voice ${voiceId} works on this plan; ` +
                        `the configured ${config.ELEVENLABS_VOICE_ID} is library-gated.`,
                );
            }
            resolvedVoiceId = voiceId;
            return voiceId;
        }
    }
    return null;
}

/** One synthesis attempt. Returns null on any failure, never throws. */
async function synthesize(
    config: Config,
    voiceId: string,
    text: string,
): Promise<string | null> {
    try {
        const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
        const client = new ElevenLabsClient({ apiKey: config.ELEVENLABS_API_KEY });

        const response = await client.textToSpeech.convert(
            voiceId,
            { text, modelId: config.ELEVENLABS_MODEL_ID, outputFormat: "mp3_44100_128" },
            // A per-request deadline and abort signal, so a slow synthesis is
            // bounded at the socket rather than merely no longer awaited. Retries
            // are OFF: a plan restriction is deterministic and the SDK's default
            // of two attempts doubled the worst case for no possible benefit.
            {
                timeoutInSeconds: VOICE_TIMEOUT_MS / 1000,
                maxRetries: 0,
                abortSignal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
            },
        );

        const bytes = await readAll(response);
        return bytes.length === 0 ? null : Buffer.from(bytes).toString("base64");
    } catch {
        return null;
    }
}

export async function narrate(config: Config, text: string): Promise<string | null> {
    if (!hasElevenLabs(config) || !shouldTry("elevenlabs")) return null;

    const cached = resolvedVoiceId;
    if (cached) {
        const direct = await synthesize(config, cached, text);
        if (direct) {
            noteOk("elevenlabs");
            return `data:audio/mpeg;base64,${direct}`;
        }
        // The voice stopped working — re-probe rather than failing outright.
        resolvedVoiceId = null;
    }

    // A "test" probe doubles as the real synthesis when nothing is cached, so
    // the common path costs exactly one request.
    const voiceId = await resolveVoice(config);
    if (!voiceId) {
        noteStatusFailure(
            "elevenlabs",
            402,
            "No voice on this plan is available via the API. " +
                "Free tiers cannot use ElevenLabs library voices — either " +
                "clone a voice or upgrade.",
        );
        return null;
    }

    const audio = await synthesize(config, voiceId, text);
    if (!audio) {
        noteStatusFailure("elevenlabs", 0, "ElevenLabs synthesis failed.");
        return null;
    }

    noteOk("elevenlabs");
    return `data:audio/mpeg;base64,${audio}`;
}

/** Why audio is missing, or undefined if it simply was not configured. */
export const voiceUnavailableReason = (): string | undefined => reasonFor("elevenlabs");

/** Drain the returned stream into one buffer. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            total += value.byteLength;
        }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}