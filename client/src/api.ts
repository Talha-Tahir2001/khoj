import type { AdviceResponse, Trail } from "@khoj/shared/types";
import { conditionsText, embed, encodeVector, focalDay } from "./embed";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
    override readonly name = "ApiError";
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${BASE}${path}`, { signal });
    const body = (await res.json()) as T & { error?: boolean; code?: string; message?: string };

    if (!res.ok) {
        throw new ApiError(
            body.code ?? "UNKNOWN",
            body.message ?? `Request failed with ${res.status}`,
        );
    }
    return body;
}

export const fetchTrails = (signal?: AbortSignal): Promise<{ trails: Trail[] }> =>
    getJson("/trails", signal);

interface FetchAdviceOptions {
    trail: string;
    days: number;
    /**
     * Pass the already-embedded vector to avoid recomputing it. Supplied by the
     * second phase of the two-step flow; the first call fetches the score and
     * then embeds from it.
     */
    vector?: number[] | null;
    signal?: AbortSignal;
}

export async function fetchAdvice({
    trail,
    days,
    vector,
    signal,
}: FetchAdviceOptions): Promise<AdviceResponse> {
    const params = new URLSearchParams({ trail, days: String(days) });
    if (vector && vector.length === 768) {
        params.set("embedding", encodeVector(vector));
    }
    return getJson<AdviceResponse>(`/advice?${params.toString()}`, signal);
}

export interface AdviceResult {
    advice: AdviceResponse;
    /**
     * True when local inference ran and the server got a real vector. False means
     * retrieval fell back to keyword match on the server — which still works,
     * but cannot match phrasing the way embeddings do.
     */
    embeddedLocally: boolean;
}

/**
 * Two calls, deliberately.
 *
 * The first returns the scored days. Those days are what the user is actually
 * deciding on, and they arrive without waiting on a 300 MB model download. Only
 * then is the focal day's condition sentence embedded — in this browser — and
 * the second call carries the vector for real retrieval.
 *
 * The upside is not latency. It is that the app is fully useful on first paint
 * and offline, and the model is an enhancement rather than a gate.
 */
export async function getAdvice(opts: {
    trail: string;
    days: number;
    signal?: AbortSignal;
    onStage?: (stage: "scoring" | "embedding" | "retrieval") => void;
}): Promise<AdviceResult> {
    const { trail, days, signal, onStage } = opts;

    onStage?.("scoring");
    const scored = await fetchAdvice({ trail, days, signal });

    if (!isLocalEmbeddingEnabled()) {
        return { advice: scored, embeddedLocally: false };
    }

    const focus = focalDay(scored.days);
    if (!focus) return { advice: scored, embeddedLocally: false };

    onStage?.("embedding");
    const vector = await embed(conditionsText(focus));
    if (!vector) return { advice: scored, embeddedLocally: false };

    onStage?.("retrieval");
    const retrieved = await fetchAdvice({ trail, days, vector, signal });
    return { advice: retrieved, embeddedLocally: true };
}

const isLocalEmbeddingEnabled = (): boolean =>
    import.meta.env.VITE_LOCAL_EMBEDDING_ENABLED !== "false";

export const checkHealth = (): Promise<{ ok: boolean; uptime_s: number }> =>
    getJson("/health");

/**
 * Fetch the spoken brief on demand.
 *
 * Kept off the advice request because synthesis is slow and often unavailable,
 * and a person deciding whether to drive six hours should not wait on it. The
 * brief text is already on screen; this only runs when they press play.
 */
export async function fetchVoice(
    text: string,
    signal?: AbortSignal,
): Promise<string> {
    const params = new URLSearchParams({ text });
    const { audio_url } = await getJson<{ audio_url: string }>(
        `/voice?${params.toString()}`,
        signal,
    );
    return audio_url;
}