import type { Penalty, ScoredDay } from "@khoj/shared/types"
import { cn } from "cn"
import {
  IconCloudRain,
  IconMist,
  IconSnowflake,
  IconSunHigh,
  IconTemperature,
  IconWind,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BAND_VARIANT } from "@/lib/bands"

/**
 * A verdict card.
 *
 * The penalties are always visible. That is the whole point of the tool: a bare
 * score with no decomposition is something the user cannot sanity-check, and if
 * they cannot check it they will not act on it.
 */
export function DayCard({ day }: { day: ScoredDay }) {
  const best = day.band === "GO"

  return (
    <Card
      className={cn(
        "gap-0 border-border/70 py-0",
        best && "border-emerald-500/30 dark:border-emerald-500/40"
      )}
    >
      <CardHeader className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {formatDayName(day.date)}
            </p>
            <CardTitle className="mt-0.5 text-xl">{formatDate(day.date)}</CardTitle>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant={BAND_VARIANT[day.band]}>{day.band}</Badge>
            <span className="font-heading text-3xl leading-none font-semibold tabular-nums">
              {day.score}
            </span>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Stat icon={<IconTemperature size={15} />} text={`${Math.round(day.tmax_c)}°`} />
          <Stat
            icon={<IconCloudRain size={15} />}
            text={`${day.precip_mm} mm`}
            dim={day.precip_mm < 0.5}
          />
          {day.snow_cm > 0 && (
            <Stat icon={<IconSnowflake size={15} />} text={`${day.snow_cm} cm snow`} />
          )}
          <Stat
            icon={<IconWind size={15} />}
            text={`${Math.round(day.wind_max_kmh)} km/h`}
            dim={day.wind_max_kmh < 20}
          />
          {(day.weather_code === 45 || day.weather_code === 48) && (
            <Stat icon={<IconMist size={15} />} text="fog" />
          )}
          {day.penalties.length === 0 && (
            <Stat icon={<IconSunHigh size={15} />} text="nothing penalised" dim />
          )}
        </div>
      </CardHeader>

      {day.penalties.length > 0 && (
        <CardContent className="px-4 pb-4">
          <ul className="space-y-2 border-t border-border/70 pt-3">
            {day.penalties.map((p) => (
              <PenaltyRow key={p.key} penalty={p} />
            ))}
          </ul>
        </CardContent>
      )}

      {day.bonus.map((b) => (
        <div key={b.key} className="px-4 pb-4">
          <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              +{b.points}
            </span>{" "}
            {b.label.toLowerCase()} — {b.detail}
          </p>
        </div>
      ))}
    </Card>
  )
}

/**
 * One named penalty, with the number that produced it.
 *
 * Showing "−18 Wet ground from recent rain · 34 mm in the prior 3 days" is what
 * makes the score auditable. Without the detail it is a black box with extra
 * steps.
 */
function PenaltyRow({ penalty }: { penalty: Penalty }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="mt-px w-10 shrink-0 text-right font-semibold tabular-nums text-destructive">
        −{penalty.points}
      </span>
      <span className="min-w-0">
        <span className="font-medium">{penalty.label}</span>
        <span className="block text-xs text-muted-foreground">{penalty.detail}</span>
      </span>
    </li>
  )
}

function Stat({
  icon,
  text,
  dim = false,
}: {
  icon: React.ReactNode
  text: string
  dim?: boolean
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", dim && "opacity-45")}>
      <span aria-hidden>{icon}</span>
      {text}
    </span>
  )
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatDayName(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return DAYS[d.getDay()] ?? iso
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}