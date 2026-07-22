/**
 * Connected-component circle candidates from a binary image (pure JS).
 */

import { MIN_CIRCULARITY, MAX_ASPECT, diameterBoundsPx } from './auto-cal-constants.js';

/**
 * @typedef {Object} Candidate
 * @property {number} cx
 * @property {number} cy
 * @property {number} area
 * @property {number} perimeter
 * @property {number} circularity
 * @property {number} aspect
 * @property {number} eqDiameter
 * @property {number} bboxX
 * @property {number} bboxY
 * @property {number} bboxW
 * @property {number} bboxH
 * @property {boolean} touchesBorder
 * @property {boolean} accepted
 * @property {string} rejectReason
 */

/**
 * @param {import('./auto-cal-preprocess.js').BinaryImage} binary
 * @param {number} sourceWidth
 * @returns {Candidate[]}
 */
export function findCandidates(binary, sourceWidth) {
  const { data, width: w, height: h, scale } = binary;
  const blobs = labelBlobs(data, w, h);
  const bounds = diameterBoundsPx(sourceWidth);
  /** @type {Candidate[]} */
  const out = [];

  for (const b of blobs) {
    if (b.area < 20) continue;

    const cx = (b.sumX / b.area) * scale;
    const cy = (b.sumY / b.area) * scale;
    const area = b.area * scale * scale;
    const peri = b.perimeter * scale;
    const circularity = peri > 0 ? (4 * Math.PI * area) / (peri * peri) : 0;
    const bboxW = (b.maxX - b.minX + 1) * scale;
    const bboxH = (b.maxY - b.minY + 1) * scale;
    const aspect =
      bboxW > 0 && bboxH > 0 ? Math.max(bboxW / bboxH, bboxH / bboxW) : 99;
    const eqDiameter = 2 * Math.sqrt(area / Math.PI);
    const touchesBorder =
      b.minX <= 1 || b.minY <= 1 || b.maxX >= w - 2 || b.maxY >= h - 2;

    /** @type {Candidate} */
    const c = {
      cx,
      cy,
      area,
      perimeter: peri,
      circularity,
      aspect,
      eqDiameter,
      bboxX: b.minX * scale,
      bboxY: b.minY * scale,
      bboxW,
      bboxH,
      touchesBorder,
      accepted: true,
      rejectReason: '',
    };

    if (touchesBorder) {
      c.accepted = false;
      c.rejectReason = 'border';
    } else if (circularity < MIN_CIRCULARITY) {
      c.accepted = false;
      c.rejectReason = 'circularity';
    } else if (aspect > MAX_ASPECT) {
      c.accepted = false;
      c.rejectReason = 'aspect';
    } else if (eqDiameter < bounds.refMin || eqDiameter > bounds.largeMax) {
      c.accepted = false;
      c.rejectReason = 'size';
    }

    out.push(c);
  }

  return out;
}

/**
 * @param {Candidate[]} candidates
 * @param {number} imageWidth
 */
export function bucketBySize(candidates, imageWidth) {
  const bounds = diameterBoundsPx(imageWidth);
  const accepted = candidates.filter((c) => c.accepted);
  const large = accepted.filter(
    (c) => c.eqDiameter >= bounds.largeMin && c.eqDiameter <= bounds.largeMax
  );
  const refs = accepted.filter(
    (c) => c.eqDiameter >= bounds.refMin && c.eqDiameter <= bounds.refMax
  );
  return { large, refs, bounds };
}

/**
 * @param {Uint8Array} binary
 * @param {number} w
 * @param {number} h
 */
function labelBlobs(binary, w, h) {
  const labels = new Int32Array(w * h);
  /** @type {number[]} */
  const parent = [0];
  let next = 1;

  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (c !== r) {
      const p = parent[c];
      parent[c] = r;
      c = p;
    }
    return r;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!binary[i]) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      if (left && up) {
        labels[i] = left;
        if (left !== up) union(left, up);
      } else if (left) {
        labels[i] = left;
      } else if (up) {
        labels[i] = up;
      } else {
        parent[next] = next;
        labels[i] = next++;
      }
    }
  }

  /** @type {Map<number, { area: number, sumX: number, sumY: number, minX: number, maxX: number, minY: number, maxY: number, perimeter: number }>} */
  const stats = new Map();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let lab = labels[i];
      if (!lab) continue;
      lab = find(lab);
      labels[i] = lab;

      let s = stats.get(lab);
      if (!s) {
        s = {
          area: 0,
          sumX: 0,
          sumY: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          perimeter: 0,
        };
        stats.set(lab, s);
      }
      s.area += 1;
      s.sumX += x;
      s.sumY += y;
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;

      if (
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !binary[i - 1] ||
        !binary[i + 1] ||
        !binary[i - w] ||
        !binary[i + w]
      ) {
        s.perimeter += 1;
      }
    }
  }

  return [...stats.values()];
}
