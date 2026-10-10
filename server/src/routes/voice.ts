import { Hono } from "hono";
import { z } from "zod";
import { loadConfig, hasElevenLabs } from "../lib/config.js";
import { narrate, voiceUnavailableReason } from "../lib/voice.js";
import { shouldTry } from "../lib/upstream.js";
import { ApiError } from "./advice.js";

/**
 * Speech, on demand.
 *
 * Deliberately a separate endpoint rather than an inline `audio_url` on
 * /api/advice. Synthesis took 660 ms when it worked and over 20 s when it did
 * not; blocking the verdict on it made the whole app slow for a feature the
 * user has to press play to use anyway. Now the score arrives first and audio
 * arrives when asked for.
 */
export const voice = new Hono();

const query = z.object({
    text: z.string().min(1).max(600),
});

voice.get("/", async (c) => {
    const config = loadConfig();
    const parsed = query.safeParse({ text: c.req.query().text });

    if (!parsed.success) {
        throw new ApiError(400, "INVALID_TEXT", "Pass the brief text as ?text=");
    }

    if (!hasElevenLabs(config)) {
        throw new ApiError(503, "VOICE_UNAVAILABLE", "Speech synthesis is not configured.");
    }

    // Answer from the breaker without spending a request on a service that is
    // known to be failing.
    if (!shouldTry("elevenlabs")) {
        throw new ApiError(
            503,
            "VOICE_UNAVAILABLE",
            voiceUnavailableReason() ?? "Speech synthesis is unavailable.",
        );
    }

    const audio = await narrate(config, parsed.data.text);
    if (!audio) {
        throw new ApiError(
            503,
            "VOICE_UNAVAILABLE",
            voiceUnavailableReason() ?? "Speech synthesis failed.",
        );
    }

    // Sent as JSON rather than a data URL: a base64 MP3 inside a JSON body is
    // 33% larger, and this is fetched exactly once when the user presses play.
    const base64 = audio.slice("data:audio/mpeg;base64,".length);
    return c.json({ audio_url: `data:audio/mpeg;base64,${base64}` });
});