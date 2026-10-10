import type { Config } from "./config.js";
import { hasElevenLabs } from "./config.js";

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

    try {
        const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
        const client = new ElevenLabsClient({ apiKey: config.ELEVENLABS_API_KEY });

        const response = await client.textToSpeech.convert(config.ELEVENLABS_VOICE_ID, {
            text,
            modelId: config.ELEVENLABS_MODEL_ID,
            outputFormat: "mp3_44100_128",
        });

        const bytes = await readAll(response);
        if (bytes.length === 0) return null;

        // Served as a data URL so the client needs no second request, and so the
        // audio survives with the offline cache alongside the brief.
        return `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
        return null;
    }
}

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