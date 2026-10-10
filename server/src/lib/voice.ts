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
 * Readable explanations for the status codes that mean "this will never work
 * until billing changes". Silence here is what made a quota exhaustion
 * indistinguishable from a flaky network.
 */
const VOICE_ERRORS: Record<string, string> = {
    "401": "ElevenLabs rejected the API key.",
    "402": "ElevenLabs free-tier quota exhausted — top up or the brief stays text-only.",
    "403": "ElevenLabs denied access to this voice.",
};

/**
 * ElevenLabs text-to-speech.
 *
 * Justified by one specific moment: you are in the car on the way to the trail
 * and you should not be reading. That is the whole case for this integration.
 *
 * Returns null when the key is absent or the call fails — the brief text is
 * still useful, and audio is not load-bearing.
 */
export async function narrate(config: Config, text: string): Promise<string | null> {
    if (!hasElevenLabs(config)) return null;
    if (!shouldTry("elevenlabs")) return null;

    try {
        const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
        const client = new ElevenLabsClient({ apiKey: config.ELEVENLABS_API_KEY });

        const response = await client.textToSpeech.convert(
            config.ELEVENLABS_VOICE_ID,
            {
                text,
                modelId: config.ELEVENLABS_MODEL_ID,
                outputFormat: "mp3_44100_128",
            },
            // A per-request deadline and abort signal, so a slow synthesis is bounded at
            // the socket rather than merely no longer awaited. Retries are OFF:
            // a billing failure is deterministic, and the SDK's default of two
            // attempts doubled the worst case for no possible benefit.
            {
                timeoutInSeconds: VOICE_TIMEOUT_MS / 1000,
                maxRetries: 0,
                abortSignal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
            },
        );

        const bytes = await readAll(response);
        if (bytes.length === 0) return null;

        noteOk("elevenlabs");

        // Served as a data URL so the client needs no second request, and so the
        // audio survives with the offline cache alongside the brief.
        return `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`;
    } catch (err) {
        const status = httpStatus(err);
        noteStatusFailure(
            "elevenlabs",
            status ?? 0,
            status
                ? (VOICE_ERRORS[String(status)] ?? `ElevenLabs returned HTTP ${status}.`)
                : "ElevenLabs is unreachable right now.",
        );
        return null;
    }
}

/** Pull an HTTP status out of whatever the SDK threw. */
function httpStatus(err: unknown): number | null {
    const e = err as { statusCode?: number; status?: number; response?: { status?: number } };
    return e?.statusCode ?? e?.status ?? e?.response?.status ?? null;
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