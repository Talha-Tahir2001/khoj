import type { ScoredDay } from "@khoj/shared/types";

/**
 * EmbeddingGemma-300M running in the browser.
 *
 * This is the load-bearing privacy property (NF1): the raw condition text is
 * turned into a vector here, on the device, and only the 768 floats cross the
 * network. The server cannot reconstruct what the weather is like where you are.
 *
 * The model is Google's open-weight embedding model from the Gemma family, in
 * ONNX, executed by Transformers.js — not an API call. That is the difference
 * between "we use a model" and "we ship a model".
 *
 * Weights are fetched from the Hugging Face CDN on first use and cached by the
 * browser. Nothing is committed to this repository.
 */

const MODEL_ID = import.meta.env.VITE_EMBEDDING_MODEL ?? "onnx-community/embeddinggemma-300m-ONNX";
const EMBEDDING_DIMENSIONS = 768;

type ProgressCallback = (info: {
    status: string;
    progress?: number;
    file?: string;
}) => void;

let extractorPromise: Promise<unknown> | null = null;

export interface EmbedderState {
    status: "idle" | "loading" | "ready" | "failed" | "disabled";
    /** 0-1. Only meaningful while loading. */
    progress: number;
    backend: "webgpu" | "wasm" | null;
    error?: string;
}

const listeners = new Set<(s: EmbedderState) => void>();

let state: EmbedderState = {
    status: import.meta.env.VITE_LOCAL_EMBEDDING_ENABLED === "false" ? "disabled" : "idle",
    progress: 0,
    backend: null,
};

export function onEmbedderState(fn: (s: EmbedderState) => void): () => void {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
}

function update(patch: Partial<EmbedderState>) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
}

export const isLocalEmbeddingEnabled = (): boolean =>
    import.meta.env.VITE_LOCAL_EMBEDDING_ENABLED !== "false";

/**
 * Load the model. Tries WebGPU first and falls back to WASM, because a judge on
 * a mid-range Android should not be left staring at a spinner.
 */
async function getExtractor(): Promise<unknown> {
    if (extractorPromise) return extractorPromise;

    extractorPromise = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");

        env.allowLocalModels = false;
        if (import.meta.env.VITE_MODEL_CACHE_DIR) {
            env.useBrowserCache = true;
        }

        const onProgress: ProgressCallback = (info) => {
            if (info.status === "progress" && typeof info.progress === "number") {
                update({ status: "loading", progress: Math.round(info.progress) / 100 });
            } else if (info.status === "ready") {
                update({ progress: 1 });
            }
        };

        const useWebGPU =
            import.meta.env.VITE_USE_WEBGPU !== "false" &&
            typeof navigator !== "undefined" &&
            "gpu" in navigator;

        update({ status: "loading", progress: 0 });

        if (useWebGPU) {
            try {
                const extractor = await pipeline("feature-extraction", MODEL_ID, {
                    dtype: "q8",
                    device: "webgpu",
                    progress_callback: onProgress,
                });
                update({ status: "ready", progress: 1, backend: "webgpu" });
                return extractor;
            } catch {
                // WebGPU exists but the adapter may be unavailable or blocked.
                update({ backend: null });
            }
        }

        const extractor = await pipeline("feature-extraction", MODEL_ID, {
            dtype: "q8",
            device: "wasm",
            progress_callback: onProgress,
        });
        update({ status: "ready", progress: 1, backend: "wasm" });
        return extractor;
    })().catch((err: unknown) => {
        extractorPromise = null;
        update({
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    });

    return extractorPromise;
}

interface FeatureExtractor {
    (text: string, options: Record<string, unknown>): Promise<{ data: Float32Array }>;
}

/**
 * Embed one condition sentence into a 768-float vector.
 *
 * Returns null rather than throwing: local inference is the preferred path, not
 * a prerequisite. A failed load degrades retrieval to keyword match on the
 * server, which is worse but not broken.
 */
export async function embed(text: string): Promise<number[] | null> {
    if (!isLocalEmbeddingEnabled()) return null;
    try {
        const extractor = (await getExtractor()) as FeatureExtractor;
        const output = await extractor(text, { pooling: "mean", normalize: true });
        const vector = Array.from(output.data as Float32Array);
        return vector.length === EMBEDDING_DIMENSIONS ? vector : null;
    } catch {
        return null;
    }
}

/** Preload in the background so the first real query is not waiting on ~300 MB. */
export function warmUp(): void {
    if (!isLocalEmbeddingEnabled() || extractorPromise) return;
    void getExtractor().catch(() => undefined);
}

/**
 * Base64 a Float32Array for the `embedding` query param.
 *
 * The request stays a GET, which keeps it cacheable by CDN and browser and
 * shareable — a friend can open the exact same advice link.
 */
export function encodeVector(vector: number[]): string {
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

/**
 * Turn a scored day into the sentence that gets embedded.
 *
 * Must stay identical to the server's copy in lib/conditions.ts — if the two
 * drift, the two retrieval paths answer the same query differently.
 */
export function conditionsText(day: ScoredDay): string {
    const parts: string[] = [];

    const weather: string[] = [];
    if (day.precip_mm > 0.5) weather.push(`${day.precip_mm} mm rain`);
    if (day.snow_cm > 0) weather.push(`${day.snow_cm} cm snow`);
    if (day.wind_max_kmh >= 20) weather.push(`wind to ${day.wind_max_kmh} km/h`);
    if (day.weather_code === 45 || day.weather_code === 48) weather.push("fog");
    if (day.weather_code === 95) weather.push("thunderstorm");

    parts.push(weather.length > 0 ? `Weather: ${weather.join(", ")}.` : "Weather: dry, clear and calm.");

    parts.push(`High of ${Math.round(day.tmax_c)}°C.`);

    if (day.penalties.length > 0) {
        const labels = day.penalties.map((p) => p.label.toLowerCase());
        parts.push(`${labels.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);
    } else {
        parts.push("Nothing in the forecast penalises it.");
    }

    return parts.join(" ");
}

/** The single day whose conditions get embedded — the one a user would drive to. */
export function focalDay(days: ScoredDay[]): ScoredDay | null {
    if (days.length === 0) return null;
    return days.reduce((best, d) => (d.score > best.score ? d : best), days[0]!);
}