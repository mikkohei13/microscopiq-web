/**
 * Shared placement for measurement mm labels: keep near the segment but avoid
 * axis-aligned box overlaps by sliding along the line and nudging perpendicular distance.
 */

/**
 * @typedef {{ midX: number, midY: number, vx: number, vy: number, tw: number, pad: number, boxH: number }} LabelLayoutItem
 */

/**
 * @typedef {{ cx: number, cy: number, boxW: number, boxH: number }} LabelPlacement
 */

/**
 * @param {LabelLayoutItem[]} items
 * @returns {LabelPlacement[]}
 */
export function computeMeasurementLabelPlacements(items) {
  const n = items.length;
  if (n === 0) return [];

  /** @type {{ item: LabelLayoutItem, tx: number, ty: number, nx: number, ny: number, segLen: number, boxW: number, maxAlong: number, basePerp: number, a: number, p: number }[]} */
  const L = items.map((it) => {
    const segLen = Math.hypot(it.vx, it.vy);
    const len = segLen || 1;
    const tx = it.vx / len;
    const ty = it.vy / len;
    let nx = -ty;
    let ny = tx;
    if (ny > 0) {
      nx = ty;
      ny = -tx;
    }
    const boxW = it.tw + 2 * it.pad;
    const basePerp = Math.max(12, it.boxH * 0.55);
    const maxAlong = Math.max(28, segLen * 0.42);
    return {
      item: it,
      tx,
      ty,
      nx,
      ny,
      segLen,
      boxW,
      maxAlong,
      basePerp,
      a: 0,
      p: basePerp,
    };
  });

  function center(row) {
    return {
      cx: row.item.midX + row.tx * row.a + row.nx * row.p,
      cy: row.item.midY + row.ty * row.a + row.ny * row.p,
    };
  }

  function rect(row) {
    const { cx, cy } = center(row);
    const h = row.item.boxH;
    const w = row.boxW;
    return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
  }

  function clampTrack(row) {
    const pMin = row.basePerp * 0.65;
    const pMax = row.basePerp + 56;
    row.a = Math.min(row.maxAlong, Math.max(-row.maxAlong, row.a));
    row.p = Math.min(pMax, Math.max(pMin, row.p));
  }

  function setFromWorld(row, cx, cy) {
    const relx = cx - row.item.midX;
    const rely = cy - row.item.midY;
    row.a = relx * row.tx + rely * row.ty;
    row.p = relx * row.nx + rely * row.ny;
    clampTrack(row);
  }

  /**
   * @param {{ left: number, top: number, right: number, bottom: number }} r1
   * @param {{ left: number, top: number, right: number, bottom: number }} r2
   * @param {number} margin
   */
  function overlap(r1, r2, margin) {
    return !(
      r1.right + margin < r2.left - margin ||
      r1.left - margin > r2.right + margin ||
      r1.bottom + margin < r2.top - margin ||
      r1.top - margin > r2.bottom + margin
    );
  }

  const margin = 2;
  for (let iter = 0; iter < 48; iter += 1) {
    let anyOverlap = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const r1 = rect(L[i]);
        const r2 = rect(L[j]);
        if (!overlap(r1, r2, margin)) continue;
        anyOverlap = true;
        const c1 = center(L[i]);
        const c2 = center(L[j]);
        let sx = c2.cx - c1.cx;
        let sy = c2.cy - c1.cy;
        const slen = Math.hypot(sx, sy);
        if (slen < 0.5) {
          sx = L[j].tx;
          sy = L[j].ty;
        } else {
          sx /= slen;
          sy /= slen;
        }
        const push = 2.8;
        const w1 = center(L[i]);
        const w2 = center(L[j]);
        setFromWorld(L[i], w1.cx - sx * push, w1.cy - sy * push);
        setFromWorld(L[j], w2.cx + sx * push, w2.cy + sy * push);
      }
    }
    if (!anyOverlap) break;
  }

  return L.map((row) => {
    const { cx, cy } = center(row);
    return { cx, cy, boxW: row.boxW, boxH: row.item.boxH };
  });
}
