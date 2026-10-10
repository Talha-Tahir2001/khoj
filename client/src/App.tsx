import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconArrowLeft, IconRefresh } from "@tabler/icons-react"
import { cn } from "cn"
import type { AdviceResponse, Trail } from "@khoj/shared/types"
import { ApiError, fetchTrails, getAdvice } from "@/api"
import { onEmbedderState, warmUp, type EmbedderState } from "@/embed"
import { readCached, writeCached, type CachedAdvice } from "@/offline"
import { Landing } from "@/components/landing"
import { DayCard } from "@/components/day-card"
import { BriefPanel } from "@/components/brief-panel"
import { SimilarPanel } from "@/components/similar-panel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ThemeToggle } from "@/components/theme-toggle"

type Stage = "idle" | "scoring" | "embedding" | "retrieval"

export function App() {
  const [trails, setTrails] = useState<Trail[]>([])
  const [trailsLoading, setTrailsLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [advice, setAdvice] = useState<CachedAdvice | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>("idle")
  const [embedder, setEmbedder] = useState<EmbedderState>({
    status: "idle",
    progress: 0,
    backend: null,
  })
  const [fromCache, setFromCache] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // A trail in the URL means the advice link is shareable — the whole reason
  // the API is a GET rather than a POST.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("trail")
    if (fromUrl) setSelected(fromUrl)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchTrails(controller.signal)
      .then((r) => setTrails(r.trails))
      .catch(() => setError("Could not reach the trail catalog."))
      .finally(() => setTrailsLoading(false))
    return () => controller.abort()
  }, [])

  useEffect(() => onEmbedderState(setEmbedder), [])

  // The service worker is what makes the shell and last advice available with
  // the network off. A registration failure must not break anything, so it only
  // costs offline support.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const register = () =>
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined)
    if (document.readyState === "complete") register()
    else window.addEventListener("load", register, { once: true })
    return () => window.removeEventListener("load", register)
  }, [])

  const load = useCallback(async (trailId: string, window: number) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setStage("scoring")

    // Paint from cache first. With the network off this is all there is, and
    // showing the last-known forecast clearly marked beats an empty screen.
    const cached = readCached(trailId, window)
    if (cached) {
      setAdvice(cached)
      setFromCache(true)
    } else {
      setAdvice(null)
      setFromCache(false)
    }

    try {
      const result = await getAdvice({
        trail: trailId,
        days: window,
        signal: controller.signal,
        onStage: setStage,
      })
      if (controller.signal.aborted) return
      const merged: CachedAdvice = {
        ...result.advice,
        embeddedLocally: result.embeddedLocally,
      }
      setAdvice(merged)
      setFromCache(false)
      writeCached(merged)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(
        cached
          ? "Offline — showing the last forecast we fetched."
          : err instanceof ApiError
            ? err.message
            : "Could not reach the server. Try again."
      )
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
        setStage("idle")
      }
    }
  }, [])

  // Start the ~300 MB model download while the user is still reading the
  // landing page. By the time they pick a trail it is usually ready.
  useEffect(() => {
    const t = setTimeout(() => warmUp(), 1200)
    return () => clearTimeout(t)
  }, [])

  const pick = useCallback(
    (trailId: string) => {
      setSelected(trailId)
      const url = new URL(window.location.href)
      url.searchParams.set("trail", trailId)
      window.history.replaceState(null, "", url)
      window.scrollTo({ top: 0 })
      void load(trailId, days)
    },
    [days, load]
  )

  const changeDays = (n: number) => {
    setDays(n)
    if (selected) void load(selected, n)
  }

  const goHome = () => {
    setSelected(null)
    setAdvice(null)
    setError(null)
    setFromCache(false)
    const url = new URL(window.location.href)
    url.searchParams.delete("trail")
    window.history.replaceState(null, "", url)
  }

  const trail = useMemo(
    () => trails.find((t) => t.id === selected) ?? null,
    [trails, selected]
  )

  if (!selected) {
    return (
      <>
        <Landing trails={trails} onPick={pick} />
        {trailsLoading ? <span className="sr-only">Loading trails</span> : null}
      </>
    )
  }

  return (
    <div className="min-h-svh">
      <TrailHeader trail={trail} onHome={goHome} embedder={embedder} />

      <main className="mx-auto max-w-2xl px-5 pb-20">
        <div className="flex flex-wrap items-center justify-between gap-3 py-5">
          <DayPicker value={days} onChange={changeDays} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load(selected, days)}
            disabled={loading}
          >
            <IconRefresh size={15} />
            Refresh
          </Button>
        </div>

        <StatusBar
          loading={loading}
          stage={stage}
          error={error}
          fromCache={fromCache}
          cachedAt={advice?.meta.generated_at ?? null}
          embedder={embedder}
        />

        {advice ? (
          <>
            <BriefPanel brief={advice.brief} trailName={advice.trail.name} />
            <BestDay days={advice.days} trailName={advice.trail.name} />
            <section className="mt-6 space-y-3">
              {advice.days.map((d) => (
                <DayCard key={d.date} day={d} />
              ))}
            </section>
            <SimilarPanel
              similar={advice.similar_conditions}
              embedded={advice.embeddedLocally}
            />
            <LiveReports reports={advice.live_reports} />
            {advice.meta.degraded && advice.meta.reasons ? (
              <DegradedNotice reasons={advice.meta.reasons} />
            ) : null}
            <Attribution />
          </>
        ) : (
          <LoadingState stage={stage} embedder={embedder} />
        )}
      </main>
    </div>
  )
}

function TrailHeader({
  trail,
  onHome,
  embedder,
}: {
  trail: Trail | null
  onHome: () => void
  embedder: EmbedderState
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHome}
            aria-label="All trails"
          >
            <IconArrowLeft size={17} />
          </Button>
          <span className="truncate font-heading text-base font-semibold">
            {trail?.name ?? "Trail"}
          </span>
          {embedder.status === "loading" && (
            <Badge variant="secondary" className="shrink-0">
              {Math.round(embedder.progress * 100)}%
            </Badge>
          )}
        </div>
        <ThemeToggle />
      </div>
    </header>
  )
}

const DAY_WINDOWS = [3, 7, 16]

function DayPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div
      role="group"
      aria-label="Forecast window"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5"
    >
      {DAY_WINDOWS.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
            value === n
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          {n} days
        </button>
      ))}
    </div>
  )
}

/**
 * Everything about trust in one strip: live or cached, is the model running
 * locally, has anything degraded. The honesty requirement made visible rather
 * than buried in a footer.
 */
function StatusBar({
  loading,
  stage,
  error,
  fromCache,
  cachedAt,
  embedder,
}: {
  loading: boolean
  stage: Stage
  error: string | null
  fromCache: boolean
  cachedAt: string | null
  embedder: EmbedderState
}) {
  return (
    <div className="min-h-8 text-sm">
      {loading && (
        <p className="text-muted-foreground">
          {stage === "scoring" && "Fetching the forecast and scoring…"}
          {stage === "embedding" &&
            (embedder.status === "loading"
              ? `Embedding on this device — ${Math.round(embedder.progress * 100)}%`
              : "Embedding the conditions on this device…")}
          {stage === "retrieval" && "Searching past conditions…"}
          {stage === "idle" && "Working…"}
        </p>
      )}

      {!loading && error && (
        <p className="text-amber-600 dark:text-amber-400">{error}</p>
      )}

      {!loading && fromCache && cachedAt && (
        <p className="text-amber-600 dark:text-amber-400">
          Cached — fetched {new Date(cachedAt).toLocaleString()}. Forecast skill
          degrades past ten days.
        </p>
      )}

      {!loading && !error && !fromCache && embedder.status === "ready" && (
        <p className="text-muted-foreground">
          EmbeddingGemma running on this device ({embedder.backend}). Your
          condition text never leaves it.
        </p>
      )}
    </div>
  )
}

function LoadingState({
  stage,
  embedder,
}: {
  stage: Stage
  embedder: EmbedderState
}) {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      {stage === "embedding" && embedder.status === "loading" && (
        <div className="pt-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.max(2, embedder.progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Downloading the embedding model once, then it is cached on this
            device. The verdict above is already live — this only improves the
            retrieval section.
          </p>
        </div>
      )}
    </div>
  )
}

function BestDay({ days, trailName }: { days: AdviceResponse["days"]; trailName: string }) {
  const best = days.reduce((b, d) => (d.score > b.score ? d : b), days[0]!)
  const worst = days.reduce((b, d) => (d.score < b.score ? d : b), days[0]!)
  const only = best.date === worst.date

  return (
    <section className="mt-4 rounded-2xl bg-primary p-5 text-primary-foreground">
      <p className="text-xs font-medium tracking-wide uppercase opacity-80">
        Best day in this window
      </p>
      <p className="font-heading mt-1 text-3xl font-semibold">
        {new Date(`${best.date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      </p>
      <p className="mt-2 text-sm leading-relaxed opacity-90">
        {only
          ? `Every day in this window scores the same. ${best.score}/100 on ${trailName}.`
          : best.band === "GO"
            ? `Good conditions on ${trailName}. ${best.score}/100.`
            : best.band === "MAYBE"
              ? `Marginal at best. ${best.score}/100 on ${trailName} — check the penalties before committing to the drive.`
              : `Not worth the drive this window. Best is ${best.score}/100.`}
      </p>
    </section>
  )
}

/**
 * What is missing, and why.
 *
 * A silently-degraded app is worse than a broken one: the user cannot tell
 * whether the absence of audio means the feature was never built or whether it
 * failed just now. The score above is unaffected either way, and this says so.
 */
function DegradedNotice({ reasons }: { reasons: Record<string, string> }) {
  const entries = Object.entries(reasons)
  if (entries.length === 0) return null

  return (
    <section className="mt-8">
      <Card className="gap-0 border-amber-500/40 bg-amber-500/5 py-0">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-sm">What is degraded</CardTitle>
          <p className="text-xs text-muted-foreground">
            The score and penalties above are unaffected — they come from
            deterministic rules, not from any of these.
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {entries.map(([key, reason]) => (
              <li key={key} className="flex gap-2">
                <span className="font-medium text-foreground">{LABELS[key] ?? key}</span>
                <span>— {reason}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}

const LABELS: Record<string, string> = {
  retrieval: "Retrieval",
  brief: "Brief",
  audio: "Audio",
  live_reports: "Live reports",
}

function LiveReports({ reports }: { reports: AdviceResponse["live_reports"] }) {
  if (reports.length === 0) return null
  return (
    <section className="mt-10">
      <h2 className="font-heading text-xl font-semibold">Recent mentions</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Web search results, cached against a 250-search budget. Coverage of
        Pakistani trails here is thin — treat these as leads, not conditions.
      </p>
      <ul className="mt-3 space-y-2">
        {reports.map((r) => (
          <li key={r.url}>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block rounded-xl border border-border bg-card p-3 transition-colors hover:bg-accent/40"
            >
              <span className="text-sm font-medium underline-offset-4">
                {r.title}
              </span>
              {r.snippet && (
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {r.snippet}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Attribution() {
  return (
    <footer className="mt-12 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
      <Separator className="mb-4" />
      <p>
        <strong className="text-foreground">How to read this.</strong> The score
        is deterministic arithmetic — mud from recent rain, ridge wind, heat,
        valley fog, early snow scaled by elevation. It is not a model output.
        Gemma does retrieval and the brief, and is given the score rather than
        computing one.
      </p>
      <p className="mt-2">
        <strong className="text-foreground">Known limits.</strong> 24
        hand-seeded observations. Mountain forecasts are reanalysis-derived and
        are the hardest case for Open-Meteo. Forecast skill degrades past about
        ten days. No thunderstorm scoring.
      </p>
      <p className="mt-2">
        Forecast data by{" "}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Open-Meteo
        </a>{" "}
        (CC BY 4.0). Embeddings by{" "}
        <a
          href="https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-4 hover:text-foreground"
        >
          EmbeddingGemma
        </a>{" "}
        from Google — Gemma terms apply, non-commercial.
      </p>
    </footer>
  )
}