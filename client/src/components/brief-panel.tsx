import { useEffect, useRef, useState } from "react"
import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react"
import type { AdviceResponse } from "@khoj/shared/types"
import { ApiError, fetchVoice } from "@/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * The spoken brief.
 *
 * The audio exists for one concrete moment: you are in the car on the way to
 * the trail and you should not be reading a screen. Everything else in the app
 * is optimised to get you out of the browser; this is the one part that plays
 * at you.
 *
 * Audio is fetched on the first press rather than bundled into the advice
 * response. Synthesis is slow and frequently unavailable, and nobody should
 * wait on it to read a verdict. A rule-based brief is labelled as such —
 * presenting a template as model output would undermine the one thing this tool
 * is asking for.
 */
export function BriefPanel({
  brief,
  trailName,
}: {
  brief: AdviceResponse["brief"]
  trailName: string
}) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cacheRef = useRef<string | null>(brief.audio_url ?? null)

  // A new brief invalidates any audio already fetched for the old one.
  useEffect(() => {
    audioRef.current?.pause()
    audioRef.current = null
    cacheRef.current = brief.audio_url ?? null
    setPlaying(false)
    setError(null)
  }, [brief.text, brief.audio_url])

  const toggle = async () => {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }

    setError(null)
    let src = cacheRef.current

    if (!src) {
      setLoading(true)
      try {
        src = await fetchVoice(brief.text)
        cacheRef.current = src
      } catch (err) {
        setLoading(false)
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not reach the speech service."
        )
        return
      }
      setLoading(false)
    }

    const el = new Audio(src)
    el.addEventListener("ended", () => setPlaying(false))
    el.addEventListener("error", () => {
      setPlaying(false)
      setError("That audio could not be played.")
    })
    audioRef.current = el
    void el.play().then(
      () => setPlaying(true),
      () => {
        setPlaying(false)
        setError("Playback was blocked. Tap play again.")
      }
    )
  }

  const canPlay = Boolean(brief.audio_url) || !isKnownUnavailable(brief.reason)

  return (
    <Card className="gap-0 border-border/70 py-0">
      <CardHeader className="px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">The brief</CardTitle>
          {canPlay ? (
            <Button size="sm" variant="secondary" onClick={() => void toggle()} disabled={loading}>
              {playing ? (
                <IconPlayerPauseFilled size={13} />
              ) : (
                <IconPlayerPlayFilled size={13} />
              )}
              {loading ? "Loading" : playing ? "Stop" : "Play"}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <IconVolumeOff size={13} />
              Text only
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        <p className="leading-relaxed">{brief.text}</p>

        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          {brief.source === "gemma" ? (
            <>
              <IconVolume size={13} className="mt-0.5 shrink-0" />
              Written by the {trailName} briefing model, given the score above
              rather than computing it.
            </>
          ) : (
            <>
              <IconVolumeOff size={13} className="mt-0.5 shrink-0" />
              Rule-based brief — the narration model is not available. Same
              numbers, no prose. The score is unchanged.
            </>
          )}
        </p>

        {brief.source === "rule" && brief.reason && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {brief.reason}
          </p>
        )}

        {error && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}

/** True when we already know speech is impossible, so don't offer the button. */
function isKnownUnavailable(reason: string | null | undefined): boolean {
  return typeof reason === "string" && /exhausted|not configured|unavailable/i.test(reason)
}