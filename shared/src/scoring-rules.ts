/**
 * Scoring constants. Single source of truth — imported by BOTH client and
 * server so the two can never disagree about what "GO" means.
 */

export const BANDS = {
    GO_MIN: 70,
    MAYBE_MIN: 45,
} as const;

/**
 * Maximum points each penalty may deduct.
 * Chosen to reflect October hazards in northern Pakistan:
 * post-monsoon mud, ridge wind, heat, valley fog, early snow on Babusar.
 */
export const MAX_PENALTY = {
    precip: 35,
    mud: 30,
    wind: 20,
    heat: 20,
    visibility: 15,
    snow: 35,
} as const;

/** Points available for the daylight bonus. */
export const MAX_DAYLIGHT_BONUS = 10;

/**
 * Total penalty points above which the day stops being viable, and the
 * daylight bonus is withheld.
 *
 * Without this, a long sunny day can lift a mud-soaked trail out of NO and
 * into MAYBE. A long day does not help when the ground is a mudslide, and a
 * score that says otherwise is worse than no score.
 */
export const VIABILITY_CEILING = 40;

/** Precipitation above this (mm) starts costing points. */
export const PRECIP_THRESHOLD_MM = 2;

/** Peak wind speed above this (km/h) starts costing points. */
export const WIND_THRESHOLD_KMH = 20;

/** Max temperature above this (°C) starts costing points. */
export const HEAT_THRESHOLD_C = 32;

/** Prior days of rain that count toward the mud penalty. */
export const MUD_LOOKBACK_DAYS = 3;

/**
 * Rain in the lookback window above this (mm) starts costing points.
 * Post-monsoon ground stays saturated well after the rain stops.
 */
export const MUD_THRESHOLD_MM = 10;

/** Elevation (m) at which the snow penalty begins to apply at all. */
export const SNOW_ELEVATION_FLOOR_M = 2000;

/** Elevation (m) at which the snow penalty reaches maximum severity. */
export const SNOW_ELEVATION_CEIL_M = 3800;

/** WMO weather codes that reduce visibility. */
export const FOG_CODES: readonly number[] = [45, 48];