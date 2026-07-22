/**
 * Match two large circles + one small reference to the printed target geometry.
 * Scale is inferred from each candidate pair’s diameters (FOV-independent).
 */

import {
  KNOWN_DISTANCE_MM,
  LARGE_DIAMETER_MM,
  REF_DIAMETER_MM,
  REF_OFFSET_MM,
  LARGE_SIZE_SIMILARITY,
  SPACING_RATIO_TOLERANCE,
  COLLINEAR_TOLERANCE,
} from './auto-cal-constants.js';

/**
 * @typedef {Object} PatternMatch
 * @property {import('./auto-cal-candidates.js').Candidate} largeA
 * @property {import('./auto-cal-candidates.js').Candidate} largeB
 * @property {import('./auto-cal-candidates.js').Candidate | null} reference
 * @property {number} pixelDistance
 * @property {number} score
 */

/** Expected A–B center distance / large diameter (unitless). */
const EXPECTED_AB_OVER_D = KNOWN_DISTANCE_MM / LARGE_DIAMETER_MM;

/** Expected reference diameter / large diameter (unitless). */
const EXPECTED_REF_OVER_D = REF_DIAMETER_MM / LARGE_DIAMETER_MM;

/**
 * @param {import('./auto-cal-candidates.js').Candidate[]} candidates
 * @param {number} [_imageWidth] unused; kept for call-site compatibility
 * @param {PatternMatch | null} [previous]
 * @returns {PatternMatch | null}
 */
export function matchPattern(candidates, _imageWidth, previous = null) {
  const accepted = candidates.filter((c) => c.accepted);
  if (accepted.length < 2) return null;

  /** @type {PatternMatch | null} */
  let best = null;

  for (let i = 0; i < accepted.length; i++) {
    for (let j = i + 1; j < accepted.length; j++) {
      const a = accepted[i];
      const b = accepted[j];
      const sizeDiff =
        Math.abs(a.eqDiameter - b.eqDiameter) / Math.max(a.eqDiameter, b.eqDiameter);
      if (sizeDiff > LARGE_SIZE_SIMILARITY) continue;

      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (dist < 1) continue;

      const avgD = (a.eqDiameter + b.eqDiameter) / 2;
      const spacingErr =
        Math.abs(dist / avgD - EXPECTED_AB_OVER_D) / EXPECTED_AB_OVER_D;
      if (spacingErr > SPACING_RATIO_TOLERANCE) continue;

      const pxPerMmGuess = avgD / LARGE_DIAMETER_MM;
      const expectedPx = EXPECTED_AB_OVER_D * avgD;
      const oriented = orientWithReference(a, b, accepted, dist, pxPerMmGuess, avgD);
      const score = scoreMatch(oriented, dist, expectedPx, sizeDiff, previous);

      if (!best || score > best.score) {
        best = {
          largeA: oriented.largeA,
          largeB: oriented.largeB,
          reference: oriented.reference,
          pixelDistance: dist,
          score,
        };
      }
    }
  }

  return best;
}

/**
 * @param {import('./auto-cal-candidates.js').Candidate} a
 * @param {import('./auto-cal-candidates.js').Candidate} b
 * @param {import('./auto-cal-candidates.js').Candidate[]} candidates
 * @param {number} abDist
 * @param {number} pxPerMmGuess
 * @param {number} avgLargeD
 */
function orientWithReference(a, b, candidates, abDist, pxPerMmGuess, avgLargeD) {
  const expectedOffset = REF_OFFSET_MM * pxPerMmGuess;
  const refNom = EXPECTED_REF_OVER_D * avgLargeD;
  /** @type {import('./auto-cal-candidates.js').Candidate | null} */
  let bestRef = null;
  let bestRefScore = -Infinity;
  let aIsNearRef = true;

  for (const r of candidates) {
    if (r === a || r === b) continue;
    if (r.eqDiameter >= Math.min(a.eqDiameter, b.eqDiameter) * 0.7) continue;
    if (r.eqDiameter < refNom * 0.4 || r.eqDiameter > refNom * 1.8) continue;

    const dA = Math.hypot(r.cx - a.cx, r.cy - a.cy);
    const dB = Math.hypot(r.cx - b.cx, r.cy - b.cy);
    const nearA = dA <= dB;
    const dNear = nearA ? dA : dB;
    const offsetErr = Math.abs(dNear - expectedOffset) / Math.max(expectedOffset, 1);

    const collinearResidual = pointLineDistance(r.cx, r.cy, a.cx, a.cy, b.cx, b.cy) / abDist;
    const offLineOk = collinearResidual > 0.15 && collinearResidual < 1.2;
    if (!offLineOk && offsetErr > 0.6) continue;

    const s = r.circularity * 2 - offsetErr * 2 + (offLineOk ? 0.5 : 0);
    if (s > bestRefScore) {
      bestRefScore = s;
      bestRef = r;
      aIsNearRef = nearA;
    }
  }

  if (bestRef) {
    return aIsNearRef
      ? { largeA: a, largeB: b, reference: bestRef }
      : { largeA: b, largeB: a, reference: bestRef };
  }

  return { largeA: a, largeB: b, reference: null };
}

/**
 * @param {{ largeA: import('./auto-cal-candidates.js').Candidate, largeB: import('./auto-cal-candidates.js').Candidate, reference: import('./auto-cal-candidates.js').Candidate | null }} oriented
 * @param {number} dist
 * @param {number} expectedPx
 * @param {number} sizeDiff
 * @param {PatternMatch | null} previous
 */
function scoreMatch(oriented, dist, expectedPx, sizeDiff, previous) {
  const { largeA, largeB, reference } = oriented;
  const circ = (largeA.circularity + largeB.circularity) / 2;
  const spacingFit = 1 - Math.min(1, Math.abs(dist - expectedPx) / expectedPx);
  const sizeSim = 1 - sizeDiff;
  let refBonus = 0;
  if (reference) {
    refBonus = 0.35 + reference.circularity * 0.15;
  }

  let continuity = 0;
  if (previous) {
    const dPrev = Math.abs(dist - previous.pixelDistance) / Math.max(previous.pixelDistance, 1);
    continuity = Math.max(0, 1 - dPrev * 8);
    const centerShift = Math.hypot(
      (largeA.cx + largeB.cx) / 2 - (previous.largeA.cx + previous.largeB.cx) / 2,
      (largeA.cy + largeB.cy) / 2 - (previous.largeA.cy + previous.largeB.cy) / 2
    );
    continuity += Math.max(0, 1 - centerShift / (dist * 0.2)) * 0.5;
  }

  let collinearTerm = 1;
  if (reference) {
    const resid =
      pointLineDistance(
        reference.cx,
        reference.cy,
        largeA.cx,
        largeA.cy,
        largeB.cx,
        largeB.cy
      ) / dist;
    const targetResid = REF_OFFSET_MM / KNOWN_DISTANCE_MM;
    collinearTerm =
      1 -
      Math.min(1, Math.abs(resid - targetResid) / Math.max(COLLINEAR_TOLERANCE, 0.01));
  }

  return circ * 2 + spacingFit * 3 + sizeSim * 1.5 + refBonus + continuity + collinearTerm;
}

function pointLineDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}
