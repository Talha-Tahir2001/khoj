import type { Band, Penalty, ScoredDay } from "@khoj/shared/types";
import { cn } from "cn";
import { IconCloudRain, IconMist, IconSnowflake, IconSunHigh, IconTemperature, IconWind } from "@tabler/icons-react";
import { BAND_STYLES } from "@/lib/bands";

/**
 * A verdict card.
 *
 * The penalties are always visible. That is the whole point of the tool: a bare
 * score with no decomposition is something the user cannot sanity-check, and if
 * they cannot check it they will not act on it.
 */
export function DayCard({ day, expanded }: { day: ScoredDay; expanded: boolean }) {
    const style = BAND_STYLES[day.band];

    return (
        <article
            className={cn(
                "rounded-2xl border border-border bg-card p-4",
                "transition-colors",
                expanded && "ring-2 ring-primary/20",
            )}
        >
            <header className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">{formatDate(day.date)}</p>
                    <p className="font-heading text-2xl leading-tight font-semibold">
                        {formatDayName(day.date)}
                    </p>
                </div>
                <div className="flex shrink-0 items-baseline gap-2">
                    <span
                        className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide",
                            style.badge,
                        )}
                    >
                        {day.band}
                    </span>
                    <span className="font-heading text-3xl font-semibold tabular-nums">
                        {day.score}
                    </span>
                </div>
            </header>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
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

            {day.penalties.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-border pt-3">
                    {day.penalties.map((p) => (
                        <PenaltyRow key={p.key} penalty={p} />
                    ))}
                </ul>
            )}

            {day.bonus.map((b) => (
                <p key={b.key} className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="font-medium text-primary">+{b.points}</span> {b.label.toLowerCase()} —{" "}
                    {b.detail}
                </p>
            ))}
        </article>
    );
}

/**
 * One named penalty, with the number that produced it.
 *
 * Showing "−18 Wet ground from recent rain · 34 mm in the prior 3 days" is what
 * makes the score auditable. Without the detail it is a black box with extra steps.
 */
function PenaltyRow({ penalty }: { penalty: Penalty }) {
    return (
        <li className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 w-11 shrink-0 text-right font-semibold tabular-nums text-destructive">
                −{penalty.points}
            </span>
            <span className="min-w-0">
                <span className="font-medium">{penalty.label}</span>
                <span className="block text-xs text-muted-foreground">{penalty.detail}</span>
            </span>
        </li>
    );
}

function Stat({
    icon,
    text,
    dim = false,
}: {
    icon: React.ReactNode;
    text: string;
    dim?: boolean;
}) {
    return (
        <span className={cn("inline-flex items-center gap-1.5", dim && "opacity-50")}>
            <span aria-hidden>{icon}</span>
            {text}
        </span>
    );
}

export function bandLabel(band: Band): string {
    switch (band) {
        case "GO":
            return "GO";
        case "MAYBE":
            return "MAYBE";
        case "NO":
            return "NO";
    }
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDayName(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return DAYS[d.getDay()] ?? iso;
}

function formatDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}