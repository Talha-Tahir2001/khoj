import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { cn } from "cn";
import type { AdviceResponse, Trail } from "@khoj/shared/types";
import { ApiError, fetchTrails, getAdvice } from "@/api";
import { onEmbedderState, warmUp, type EmbedderState } from "@/embed";
import { readCached, writeCached, type CachedAdvice } from "@/offline";
import { DayCard } from "@/components/day-card";
import { BriefPanel } from "@/components/brief-panel";
import { SimilarPanel } from "@/components/similar-panel";
import { Button } from "@/components/ui/button";

type Stage = "idle" | "scoring" | "embedding" | "retrieval";

export function App() {
    const [trails, setTrails] = useState<Trail[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [days, setDays] = useState(7);
    const [advice, setAdvice] = useState<CachedAdvice | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stage, setStage] = useState<Stage>("idle");
    const [embedder, setEmbedder] = useState<EmbedderState>({
        status: "idle",
        progress: 0,
        backend: null,
    });
    const [fromCache, setFromCache] = useState(false);

    const abortRef = useRef<AbortController | null>(null);

    // Read ?trail= so an advice link is shareable — the whole reason the API is a GET.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get("trail");
        setSelected(fromUrl ?? null);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        fetchTrails(controller.signal)
            .then((r) => setTrails(r.trails))
            .catch(() => setError("Could not reach the trail catalog."));
        return () => controller.abort();
    }, []);

    useEffect(() => onEmbedderState(setEmbedder), []);

    // The service worker is what makes the shell and last advice available with
    // the network off. Its absence must not break anything, so registration
    // failures are ignored — they only cost offline support.
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        const register = () =>
            navigator.serviceWorker
                .register("/sw.js", { scope: "/" })
                .catch(() => undefined);
        if (document.readyState === "complete") register();
        else window.addEventListener("load", register, { once: true });
        return () => window.removeEventListener("load", register);
    }, []);

    const load = useCallback(
        async (trailId: string, window_days: number) => {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            setLoading(true);
            setError(null);
            setStage("scoring");

            // Paint from cache first. With the network off this is all there is,
            // and showing the last-known forecast clearly marked is better than
            // an empty screen.
            const cached = readCached(trailId, window_days);
            if (cached) {
                setAdvice(cached);
                setFromCache(true);
            } else {
                setAdvice(null);
                setFromCache(false);
            }

            try {
                const result = await getAdvice({
                    trail: trailId,
                    days: window_days,
                    signal: controller.signal,
                    onStage: setStage,
                });
                if (controller.signal.aborted) return;
                setAdvice({ ...result.advice, embeddedLocally: result.embeddedLocally });
                setFromCache(false);
                writeCached({ ...result.advice, embeddedLocally: result.embeddedLocally });
            } catch (err) {
                if (controller.signal.aborted) return;
                if (cached) {
                    setError("Offline — showing the last forecast we fetched.");
                } else {
                    setError(
                        err instanceof ApiError
                            ? err.message
                            : "Could not reach the server. Try again.",
                    );
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                    setStage("idle");
                }
            }
        },
        [],
    );

    // Start the 300 MB model download while the user is still reading the trail list.
    useEffect(() => {
        const t = setTimeout(() => warmUp(), 1500);
        return () => clearTimeout(t);
    }, []);

    const select = (trailId: string) => {
        setSelected(trailId);
        const url = new URL(window.location.href);
        url.searchParams.set("trail", trailId);
        window.history.replaceState(null, "", url);
        void load(trailId, days);
    };

    const changeDays = (n: number) => {
        setDays(n);
        if (selected) void load(selected, n);
    };

    const trail = useMemo(
        () => trails.find((t) => t.id === selected) ?? null,
        [trails, selected],
    );

    return (
        <div className="mx-auto min-h-svh max-w-2xl px-4 pb-24">
            <Header />

            <TrailPicker trails={trails} selected={selected} onSelect={select} />

            {selected && (
                <div className="mt-4 flex items-center justify-between gap-3">
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
            )}

            <StatusBar
                loading={loading}
                stage={stage}
                error={error}
                fromCache={fromCache}
                cachedAt={advice?.meta.generated_at ?? null}
                embedder={embedder}
            />

            {advice && trail && (
                <>
                    <BriefPanel brief={advice.brief} trailName={advice.trail.name} />
                    <VerdictStrip days={advice.days} />
                    <section className="mt-4 space-y-3">
                        {advice.days.map((d) => (
                            <DayCard key={d.date} day={d} expanded={d.band === "GO"} />
                        ))}
                    </section>
                    <SimilarPanel similar={advice.similar_conditions} embedded={advice.embeddedLocally} />
                    <LiveReports reports={advice.live_reports} />
                    <Footer />
                </>
            )}
        </div>
    );
}

function Header() {
    return (
        <header className="pt-8 pb-6">
            <h1 className="font-heading text-4xl leading-none font-semibold">
                Which Saturday is worth the drive?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Six trails in northern Pakistan, scored on deterministic rules. Every point
                deducted is named below.
            </p>
        </header>
    );
}

function TrailPicker({
    trails,
    selected,
    onSelect,
}: {
    trails: Trail[];
    selected: string | null;
    onSelect: (id: string) => void;
}) {
    if (trails.length === 0) return null;
    return (
        <div className="flex gap-2 overflow-x-auto pb-2">
            {trails.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(t.id)}
                    aria-pressed={selected === t.id}
                    className={cn(
                        "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                        selected === t.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card hover:bg-muted",
                    )}
                >
                    {t.name}
                </button>
            ))}
        </div>
    );
}

const DAY_WINDOWS = [3, 7, 16];

function DayPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
    return (
        <div className="flex gap-1 rounded-full border border-border p-0.5">
            {DAY_WINDOWS.map((n) => (
                <button
                    key={n}
                    type="button"
                    onClick={() => onChange(n)}
                    className={cn(
                        "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                        value === n ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                >
                    {n}d
                </button>
            ))}
        </div>
    );
}

/**
 * Everything the user needs to know about trust in one strip: is this live or
 * cached, is the model running locally, has anything degraded.
 *
 * This is the honesty requirement made visible rather than buried in a footer.
 */
function StatusBar({
    loading,
    stage,
    error,
    fromCache,
    cachedAt,
    embedder,
}: {
    loading: boolean;
    stage: Stage;
    error: string | null;
    fromCache: boolean;
    cachedAt: string | null;
    embedder: EmbedderState;
}) {
    return (
        <div className="mt-4 min-h-6 text-xs">
            {loading && (
                <p className="text-muted-foreground">
                    {stage === "scoring" && "Fetching forecast and scoring…"}
                    {stage === "embedding" &&
                        (embedder.status === "loading"
                            ? `Embedding locally on your device — ${Math.round(embedder.progress * 100)}%`
                            : "Embedding conditions on your device…")}
                    {stage === "retrieval" && "Searching past conditions…"}
                    {stage === "idle" && "Working…"}
                </p>
            )}
            {!loading && error && <p className="text-amber-600 dark:text-amber-400">{error}</p>}
            {!loading && fromCache && cachedAt && (
                <p className="text-amber-600 dark:text-amber-400">
                    Cached — fetched {new Date(cachedAt).toLocaleString()}. Weather skill degrades
                    past ten days.
                </p>
            )}
            {!loading && !error && !fromCache && embedder.status === "ready" && (
                <p className="text-muted-foreground">
                    EmbeddingGemma running on this device ({embedder.backend}). Your condition text
                    never leaves it.
                </p>
            )}
        </div>
    );
}

function VerdictStrip({ days }: { days: AdviceResponse["days"] }) {
    const best = days.reduce((b, d) => (d.score > b.score ? d : b), days[0]!);
    return (
        <section className="mt-6 rounded-2xl bg-primary p-5 text-primary-foreground">
            <p className="text-xs tracking-wide uppercase opacity-80">
                Best day in this window
            </p>
            <p className="font-heading mt-1 text-3xl font-semibold">
                {new Date(`${best.date}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                })}
            </p>
            <p className="mt-2 text-sm opacity-90">
                {best.band === "GO"
                    ? "Good conditions on this day."
                    : best.band === "MAYBE"
                      ? "Marginal. Check the penalties before you commit to the drive."
                      : "Not worth the drive on this day."}
            </p>
        </section>
    );
}

function LiveReports({ reports }: { reports: AdviceResponse["live_reports"] }) {
    if (reports.length === 0) return null;
    return (
        <section className="mt-8">
            <h2 className="font-heading text-xl font-semibold">Recent mentions</h2>
            <p className="mt-1 text-xs text-muted-foreground">
                Web search results, cached. Coverage of Pakistani trails here is thin.
            </p>
            <ul className="mt-3 space-y-3">
                {reports.map((r) => (
                    <li key={r.url} className="rounded-xl border border-border bg-card p-3">
                        <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-medium text-sm underline-offset-4 hover:underline"
                        >
                            {r.title}
                        </a>
                        <p className="mt-1 text-xs text-muted-foreground">{r.snippet}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function Footer() {
    return (
        <footer className="mt-10 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
            <p>
                <strong className="text-foreground">How to read this.</strong> The score is
                deterministic arithmetic — mud from recent rain, ridge wind, heat, valley fog, early
                snow scaled by elevation. It is not a model output. Gemma does retrieval and the
                spoken brief, and it is given the score rather than computing one.
            </p>
            <p className="mt-2">
                <strong className="text-foreground">Known limits.</strong> The observation corpus is
                small and hand-seeded. Mountain forecasts are reanalysis-derived and are the hardest
                case for Open-Meteo — Babusar is the least reliable row here. Forecast skill degrades
                past about ten days. No thunderstorm scoring.
            </p>
            <p className="mt-2">
                Forecast data by{" "}
                <a
                    href="https://open-meteo.com/"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-4"
                >
                    Open-Meteo
                </a>{" "}
                (CC BY 4.0). Embeddings by{" "}
                <a
                    href="https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-4"
                >
                    EmbeddingGemma
                </a>{" "}
                from Google — Gemma terms apply, non-commercial.
            </p>
        </footer>
    );
}