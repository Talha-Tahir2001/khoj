import { z } from "zod";

/**
 * Every value has a documented default and a defined fallback, so the app runs
 * with an empty .env. Only MONGO_URI has real work to do when present.
 */
const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),

    MONGO_URI: z.string().optional(),
    MONGO_DB: z.string().default("khoj"),

    SCORER: z.enum(["rules", "tabpfn"]).default("rules"),

    OPEN_METHO_BASE_URL: z.string().url().default("https://api.open-meteo.com/v1"),

    GEMINI_API_KEY: z.string().optional(),
    /**
     * Base URL for the Gemini REST API.
     *
     * Defaults to AI Studio. Point it at
     *   https://<location>-aiplatform.googleapis.com/v1/projects/<project>/locations/<location>
     * for Vertex AI, or at any gateway in front of either. That is why the brief
     * layer calls the endpoint directly instead of using @google/genai — the SDK
     * fixes the base URL and adds retries we do not control.
     */
    GEMINI_BASE_URL: z
        .string()
        .url()
        .default("https://generativelanguage.googleapis.com/v1beta"),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    GOOGLE_CLOUD_LOCATION: z.string().default("us-central1"),
    GEMINI_MODEL: z.string().default("gemma-4-31b-it"),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    GEMINI_ENABLED: z
        .string()
        .default("true")
        .transform((v) => v !== "false"),

    ELEVENLABS_API_KEY: z.string().optional(),
    ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
    ELEVENLABS_MODEL_ID: z.string().default("eleven_flash_v2_5"),

    SERPAPI_KEY: z.string().optional(),
    SERPAPI_GL: z.string().default("pk"),

    SENTRY_DSN: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_SEND_DEFAULT_PII: z
        .string()
        .default("true")
        .transform((v) => v !== "false"),
    SENTRY_ENVIRONMENT: z.string().optional(),

    PUBLIC_SITE_ORIGIN: z.string().default("http://localhost:5173"),

    CACHE_TTL_FORECAST: z.coerce.number().int().positive().default(3600),
    CACHE_TTL_SERP: z.coerce.number().int().positive().default(43200),
    CACHE_TTL_BRIEF: z.coerce.number().int().positive().default(86400),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

/**
 * A URI containing an unresolved `<placeholder>` is the single most likely
 * first-run mistake, and it fails silently: the server starts, logs that it is
 * degraded, and quietly serves keyword search forever. Catch it at the door.
 */
export function assertNoPlaceholders(config: Config): void {
    const problems: string[] = [];

    for (const key of ["MONGO_URI"] as const) {
        const value = config[key];
        if (value && /<[^>]+>/.test(value)) {
            problems.push(
                `${key} still contains a <placeholder>. Copy the real value — for Atlas, ` +
                    `Connect → Drivers — and replace <cluster> and <password>.`,
            );
        }
    }

    if (problems.length > 0) {
        console.error(`[khoj] refusing to start with unresolved placeholders:\n  - ${problems.join("\n  - ")}`);
        process.exit(1);
    }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    if (cached) return cached;
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
        throw new Error(`Invalid environment: ${issues}`);
    }
    cached = parsed.data;
    return cached;
}

/** True when the Atlas layer is usable. Retrieval degrades to keyword match otherwise. */
export const hasAtlas = (c: Config): boolean => Boolean(c.MONGO_URI);

/** True when the model-backed brief is available. Otherwise the rule fallback runs. */
export const hasGemma = (c: Config): boolean => c.GEMINI_ENABLED && Boolean(c.GEMINI_API_KEY);

export const hasSerpApi = (c: Config): boolean => Boolean(c.SERPAPI_KEY);

export const hasElevenLabs = (c: Config): boolean => Boolean(c.ELEVENLABS_API_KEY);