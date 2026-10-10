import type { Band } from "@khoj/shared/types"

/**
 * Band presentation. Three states, read at a glance on a phone in a car park.
 *
 * Colour is never the only signal — every badge carries its own word, so the
 * verdict survives colour-blindness and a sunlit screen.
 */
export const BAND_LABEL: Record<Band, string> = {
  GO: "GO",
  MAYBE: "MAYBE",
  NO: "NO",
}

export const BAND_VARIANT: Record<Band, "default" | "secondary" | "destructive"> = {
  GO: "default",
  MAYBE: "secondary",
  NO: "destructive",
}