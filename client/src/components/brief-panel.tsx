import { useState } from "react";
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconVolume } from "@tabler/icons-react";
import type { AdviceResponse } from "@khoj/shared/types";
import { Button } from "@/components/ui/button";

/**
 * The spoken brief.
 *
 * The audio exists for one concrete moment: you are in the car on the way to the
 * trail and you should not be reading a screen. Everything else in the app is
 * optimised to get you out of the browser; this is the one part that plays at you.
 *
 * A rule-based brief is labelled as such. Presenting a template as model output
 * would undermine the one thing this tool is asking for.
 */
export function BriefPanel({
    brief,
    trailName,
}: {
    brief: AdviceResponse["brief"];
    trailName: string;
}) {
    const [playing, setPlaying] = useState(false);
    const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

    const toggle = () => {
        if (!brief.audio_url) return;

        if (!audio) {
            const el = new Audio(brief.audio_url);
            el.addEventListener("ended", () => setPlaying(false));
            setAudio(el);
        }

        const el = audio ?? new Audio(brief.audio_url);
        if (el.paused) {
            void el.play();
            setPlaying(true);
        } else {
            el.pause();
            setPlaying(false);
        }
    };

    return (
        <section className="mt-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold">The brief</h2>
                {brief.audio_url ? (
                    <Button size="sm" variant="secondary" onClick={toggle}>
                        {playing ? (
                            <IconPlayerPauseFilled size={14} />
                        ) : (
                            <IconPlayerPlayFilled size={14} />
                        )}
                        {playing ? "Stop" : "Play"}
                    </Button>
                ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <IconVolume size={14} />
                        Text only
                    </span>
                )}
            </div>

            <p className="mt-2 leading-relaxed">{brief.text}</p>

            <p className="mt-3 text-xs text-muted-foreground">
                {brief.source === "gemma"
                    ? `Written by ${trailName} briefing model, given the score above rather than computing it.`
                    : "Rule-based brief — the narration model is not configured. Same numbers, no prose."}
            </p>
        </section>
    );
}