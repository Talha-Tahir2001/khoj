import { IconArrowRight, IconCloudRain, IconRoute } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { Trail } from "@khoj/shared/types"
import { ThemeToggle } from "@/components/theme-toggle"

/**
 * The landing page.
 *
 * It has one job: make the problem feel real in about three seconds, so that
 * picking a trail feels like the obvious next step rather than a form to fill
 * in. No feature tour, no hero image, no carousel.
 */
export function Landing({
  trails,
  onPick,
}: {
  trails: Trail[]
  onPick: (trailId: string) => void
}) {
  return (
    <div className="min-h-svh">
      <SiteHeader />

      <main className="mx-auto max-w-5xl px-5">
        <Hero />

        <section aria-labelledby="trails-heading" className="mt-14 pb-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2
                id="trails-heading"
                className="font-heading text-2xl font-semibold tracking-tight"
              >
                Pick a trail
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Six trails, scored on the forecast for the next 3, 7 or 16 days.
              </p>
            </div>
          </div>

          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {trails.map((trail) => (
              <li key={trail.id}>
                <button
                  type="button"
                  onClick={() => onPick(trail.id)}
                  className="group flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <span className="font-heading text-xl leading-tight font-semibold">
                      {trail.name}
                    </span>
                    <IconArrowRight
                      size={18}
                      className="mt-0.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{trail.elevation_m} m</Badge>
                    <Badge variant="secondary">
                      {trail.difficulty}
                    </Badge>
                    <Badge variant="secondary">
                      ~{trail.typical_hours} h
                    </Badge>
                  </div>

                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {trail.notes}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <HowItWorks />
      </main>

      <SiteFooter />
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <IconRoute size={14} />
          </span>
          <span className="font-heading text-base font-semibold">Khoj</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="pt-14 pb-2 sm:pt-20">
      <Badge variant="outline" className="mb-5">
        <IconCloudRain size={12} />
        Six trails · northern Pakistan
      </Badge>

      <h1 className="font-heading max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
        Which Saturday is worth the drive?
      </h1>

      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty">
        Babusar is six hours each way. Post-monsoon mud, ridge wind and first
        snow above 3,000&nbsp;m can each close a trail on you. Khoj scores the
        forecast for a named trail and shows{" "}
        <strong className="font-medium text-foreground">
          every point it deducted
        </strong>
        , so you can check the number before you drive to it.
      </p>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        The score is deterministic arithmetic, not a model's opinion. Gemma does
        the retrieval — finding past days that felt like this one — and writes
        the brief. The open-weight embedding model runs in your browser, so the
        conditions text never leaves your device.
      </p>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Score",
      body: "Six penalties, each mapped to a real October hazard: mud from recent rain, ridge wind, heat, valley fog, snow scaled by elevation.",
    },
    {
      n: "02",
      title: "Decompose",
      body: "Every deduction is named and quantified. If it says NO, you can see which term did it and argue with it.",
    },
    {
      n: "03",
      title: "Compare",
      body: "Past days on that trail with similar conditions, retrieved semantically — and what was actually reported on them.",
    },
    {
      n: "04",
      title: "Go",
      body: "A three-sentence brief you can listen to in the car. Then close the browser, which is the point.",
    },
  ]

  return (
    <section aria-labelledby="how-heading" className="border-t border-border py-14">
      <h2 id="how-heading" className="font-heading text-2xl font-semibold tracking-tight">
        How it works
      </h2>

      <ol className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <li key={step.n}>
            <p className="font-mono text-xs text-muted-foreground">{step.n}</p>
            <p className="mt-1.5 font-heading text-lg font-semibold">{step.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-5 py-10">
        <Separator className="mb-6" />
        <div className="grid gap-6 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
          <div>
            <p>
              <strong className="text-foreground">Limitations, plainly.</strong>{" "}
              The score is hand-tuned arithmetic, not calibrated against labelled
              outcomes. The observation corpus is 24 hand-seeded notes, so
              retrieval quality is bounded by that. Mountain forecasts are the
              hardest case for Open-Meteo and Babusar is the least reliable row.
              Skill degrades past about ten days. Thunderstorms are not scored.
            </p>
          </div>
          <div>
            <p>
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
              from Google. Gemma terms apply; non-commercial.
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}