import type { AdviceResponse } from "@khoj/shared/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const OUTCOME_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  good: "default",
  partial: "secondary",
  bad: "destructive",
}

/**
 * Past days on this trail whose conditions were similar.
 *
 * This is where the open-weight model earns its place. "Muddy after rain, stream
 * crossing high" has to match a note written as "the lower path was a mess after
 * Wednesday's rain, had to wade the stream". Lexical matching cannot do that,
 * and a lookup table cannot do it at all.
 */
export function SimilarPanel({
  similar,
  embedded,
}: {
  similar: AdviceResponse["similar_conditions"]
  embedded: boolean
}) {
  if (similar.length === 0) return null

  return (
    <section className="mt-10">
      <Card className="gap-0 border-border/70 py-0">
        <CardHeader className="px-4 py-4">
          <CardTitle className="text-lg">Days that felt like this</CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {embedded
              ? "Matched by EmbeddingGemma running in this browser. Only the 768-float vector was sent."
              : "Matched by keyword search on the server — local embedding was unavailable, so this cannot match phrasing the way embeddings do."}
          </p>
        </CardHeader>

        <CardContent className="space-y-2 px-4 pb-4">
          {similar.map((s) => (
            <Card
              key={`${s.trail ?? ""}-${s.date}`}
              className="gap-0 border-border/50 bg-accent/20 py-3"
            >
              <CardHeader className="px-3 py-0">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm">
                    {new Date(`${s.date}T00:00:00`).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </CardTitle>
                  <Badge variant={OUTCOME_VARIANT[s.outcome] ?? "secondary"}>
                    {s.outcome}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-3 pt-2">
                <p className="text-sm leading-relaxed">{s.field_note}</p>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}