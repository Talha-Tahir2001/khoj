import type { AdviceResponse } from "@khoj/shared/types";

const OUTCOME_STYLES: Record<string, string> = {
    good: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
    partial: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    bad: "bg-red-600/10 text-red-700 dark:text-red-400",
};

/**
 * Past days on this trail whose conditions were similar.
 *
 * This is where the open-weight model earns its place. "Muddy after rain, stream
 * crossing high" has to match a note written as "the lower path was a mess after
 * Wednesday's rain, had to wade the stream". Lexical matching cannot do that, and
 * a lookup table cannot do it at all.
 */
export function SimilarPanel({
    similar,
    embedded,
}: {
    similar: AdviceResponse["similar_conditions"];
    embedded: boolean;
}) {
    if (similar.length === 0) return null;

    return (
        <section className="mt-8">
            <h2 className="font-heading text-xl font-semibold">Days that felt like this</h2>
            <p className="mt-1 text-xs text-muted-foreground">
                {embedded
                    ? "Matched by EmbeddingGemma running in your browser. Only the 768-float vector was sent."
                    : "Matched by keyword search. Local embedding was unavailable, so this fallback cannot match phrasing the way embeddings do."}
            </p>

            <ul className="mt-3 space-y-3">
                {similar.map((s) => (
                    <li key={`${s.trail ?? ""}-${s.date}`} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">
                                {new Date(`${s.date}T00:00:00`).toLocaleDateString(undefined, {
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric",
                                })}
                            </span>
                            <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLES[s.outcome] ?? ""}`}
                            >
                                {s.outcome}
                            </span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed">{s.field_note}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}