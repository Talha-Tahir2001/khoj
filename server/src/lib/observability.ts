import * as Sentry from "@sentry/node";
import type { Span } from "@sentry/node";
import type { Config } from "./config.js";

/** Span attribute values Sentry accepts. */
type SpanAttrs = Record<string, string | number | boolean | undefined>;

/**
 * Sentry init plus the gen_ai.* span helpers.
 *
 * Auto-instrumentation does not fire on Hono, so the spans are manual. This is
 * not decoration: the latency and token table in the write-up comes out of
 * these spans, and the challenge's Sentry category asks for it by name.
 */

let initialised = false;

export function initObservability(config: Config): void {
    if (initialised || !config.SENTRY_DSN) return;
    initialised = true;

    Sentry.init({
        dsn: config.SENTRY_DSN,
        tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
        environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
    });
}

export const AGENT_NAME = "Khoj Planner";

/**
 * Parent span for one advice request. Everything the request does — the
 * Open-Meteo fetch, the SerpApi search, the Gemma call — hangs off this.
 */
export function startAgentSpan(requestId: string): Span {
    const span = Sentry.startInactiveSpan({
        name: "invoke_agent Khoj Planner",
        op: "gen_ai.invoke_agent",
        attributes: {
            "khoj.request_id": requestId,
            "khoj.agent.name": AGENT_NAME,
        },
    });
    Sentry.withActiveSpan(span, () => undefined);
    return span;
}

function childOf(parent: Span, name: string, op: string, attributes: SpanAttrs): Span {
    return Sentry.startInactiveSpan({ name, op, parentSpan: parent, attributes });
}

export interface ChatSpanOptions {
    model: string;
    conversationId: string;
    prompt: string;
    /** Shown in the Sentry UI. Kept short — full prompt text is PII. */
    promptPreview?: string;
}

export interface ChatUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface ChatSpanResult<T> {
    result: T;
    usage: ChatUsage;
}

/**
 * Run one model call inside its own `gen_ai.chat` span and return both the
 * result and the token accounting the write-up needs.
 */
export async function withChatSpan<T>(
    parent: Span | null,
    opts: ChatSpanOptions,
    call: () => Promise<T>,
): Promise<ChatSpanResult<T>> {
    // Attributes are set at span START, before the call, so head-based sampling
    // can use them.
    const span = parent
        ? childOf(parent, `chat ${opts.model}`, "gen_ai.chat", {
              "gen_ai.request.model": opts.model,
              "gen_ai.system": "khoj.brief",
              "khoj.conversation_id": opts.conversationId,
          })
        : Sentry.startInactiveSpan({ name: `chat ${opts.model}`, op: "gen_ai.chat" });

    try {
        const result = await call();
        const usage = extractUsage(result);
        span.setAttributes({
            "gen_ai.response.model": opts.model,
            "gen_ai.usage.input_tokens": usage.inputTokens,
            "gen_ai.usage.output_tokens": usage.outputTokens,
            "gen_ai.usage.total_tokens": usage.inputTokens + usage.outputTokens,
            "khoj.prompt_preview": opts.promptPreview ?? opts.prompt.slice(0, 160),
        });
        return { result, usage };
    } finally {
        span.end();
    }
}

export interface ToolSpanResult<T> {
    result: T;
    durationMs: number;
}

export async function withToolSpan<T>(
    parent: Span | null,
    toolName: string,
    attrs: SpanAttrs,
    call: () => Promise<T>,
): Promise<ToolSpanResult<T>> {
    const span = parent
        ? childOf(parent, `execute_tool ${toolName}`, "gen_ai.execute_tool", {
              "gen_ai.tool.name": toolName,
              ...attrs,
          })
        : Sentry.startInactiveSpan({
              name: `execute_tool ${toolName}`,
              op: "gen_ai.execute_tool",
              attributes: { "gen_ai.tool.name": toolName, ...attrs },
          });

    const started = Date.now();
    try {
        const result = await call();
        span.setAttribute("khoj.duration_ms", Date.now() - started);
        return { result, durationMs: Date.now() - started };
    } finally {
        span.end();
    }
}

/** Pull usage metadata out of a @google/genai response, tolerating its shape. */
function extractUsage<T>(result: T): ChatUsage {
    const meta = result as {
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    } | null;
    const u = meta?.usageMetadata;
    return {
        inputTokens: u?.promptTokenCount ?? 0,
        outputTokens: u?.candidatesTokenCount ?? 0,
    };
}

/** Multi-turn activity groups into one Sentry Conversation view. */
export function setConversationId(id: string): void {
    Sentry.setConversationId(id);
}

export function captureError(err: unknown, context: Record<string, unknown> = {}): void {
    Sentry.captureException(err, { extra: context });
}