/**
 * Geometry and detection thresholds for three-circle auto-calibration.
 * Tweak these directly — there is no tuning UI.
 *
 * Matching is scale-invariant: absolute pixel sizes are inferred from each
 * candidate pair’s diameters, not from an assumed field of view.
 */

/** Known center-to-center distance between Large A and Large B (mm). */
export const KNOWN_DISTANCE_MM = 5;

/** Nominal large-circle diameter (mm). */
export const LARGE_DIAMETER_MM = 1.45;

/** Nominal reference-circle diameter (mm). */
export const REF_DIAMETER_MM = 0.7;

/** Reference offset from Large A, perpendicular to A–B (mm). */
export const REF_OFFSET_MM = 2.5;

/** Min equivalent diameter in source pixels (reject speckles). */
export const MIN_DIAMETER_PX = 8;

/** Max equivalent diameter as a fraction of image width. */
export const MAX_DIAMETER_FRAC = 0.55;

/** Max relative difference between the two large diameters. */
export const LARGE_SIZE_SIMILARITY = 0.25;

/**
 * Allowed relative error on A–B spacing vs expected
 * (expected = avgDiameter × KNOWN_DISTANCE_MM / LARGE_DIAMETER_MM).
 */
export const SPACING_RATIO_TOLERANCE = 0.35;

/** Collinearity tolerance used when scoring reference offset. */
export const COLLINEAR_TOLERANCE = 0.15;

/** Circularity = 4π·area / perimeter²; reject below this. */
export const MIN_CIRCULARITY = 0.65;

/** Max aspect ratio (width/height or height/width). */
export const MAX_ASPECT = 1.35;
