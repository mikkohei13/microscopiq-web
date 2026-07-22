/**
 * Geometry and detection thresholds for three-circle auto-calibration.
 * Tweak these directly — there is no tuning UI.
 */

/** Known center-to-center distance between Large A and Large B (mm). */
export const KNOWN_DISTANCE_MM = 5;

/** Nominal large-circle diameter (mm). */
export const LARGE_DIAMETER_MM = 1.45;

/** Nominal reference-circle diameter (mm). */
export const REF_DIAMETER_MM = 0.7;

/** Reference offset from Large A, perpendicular to A–B (mm). */
export const REF_OFFSET_MM = 2.5;

/** Expected field of view across the frame width (mm). Used for size bounds. */
export const EXPECTED_FOV_MM = 10;

/** Max relative difference between the two large diameters. */
export const LARGE_SIZE_SIMILARITY = 0.25;

/** Allowed relative error on A–B spacing vs expected (from diameter-based scale guess). */
export const SPACING_RATIO_TOLERANCE = 0.35;

/** Collinearity tolerance used when scoring reference offset. */
export const COLLINEAR_TOLERANCE = 0.15;

/** Circularity = 4π·area / perimeter²; reject below this. */
export const MIN_CIRCULARITY = 0.65;

/** Max aspect ratio (width/height or height/width). */
export const MAX_ASPECT = 1.35;

/**
 * Diameter bounds derived from FOV + nominal sizes ± margin.
 * @param {number} imageWidthPx
 */
export function diameterBoundsPx(imageWidthPx) {
  const pxPerMm = imageWidthPx / EXPECTED_FOV_MM;
  const largeNom = LARGE_DIAMETER_MM * pxPerMm;
  const refNom = REF_DIAMETER_MM * pxPerMm;
  return {
    largeMin: largeNom * 0.35,
    largeMax: largeNom * 2.5,
    refMin: refNom * 0.25,
    refMax: refNom * 2.8,
    pxPerMmGuess: pxPerMm,
  };
}
