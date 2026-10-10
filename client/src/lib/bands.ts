import type { Band } from "@khoj/shared/types";

/**
 * Band presentation. Three states, read at a glance on a phone in a car park.
 *
 * Colour is not the only signal — each badge carries its own word, so the
 * verdict survives colour-blindness and a sunlit screen.
 */
export const BAND_STYLES: Record<Band, { badge: string; bar: string; label: string }> = {
    GO: {
        badge: "bg-emerald-600 text-white",
        bar: "bg-emerald-600",
        label: "Go",
    },
    MAYBE: {
        badge: "bg-amber-500 text-black",
        bar: "bg-amber-500",
        label: "Maybe",
    },
    NO: {
        badge: "bg-red-600 text-white",
        bar: "bg-red-600",
        label: "Don't go",
    },
};