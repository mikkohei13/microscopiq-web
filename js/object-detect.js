/**
 * Feasibility: find a large object on a mildly patterned background.
 * Assumes the object is at least ~2× larger than pattern elements.
 * Pure browser JS — no ML models.
 */

/** Max working width (px) for detection; keeps 1 Hz cheap. */
const MAX_WIDTH = 320;

/**
 * @typedef {Object} NormRect
 * @property {number} nx  left, 0–1 of frame
 * @property {number} ny  top, 0–1 of frame
 * @property {number} nw  width, 0–1 of frame
 * @property {number} nh  height, 0–1 of frame
 */

/**
 * Detect the largest object-like region in an ImageData frame.
 * @param {ImageData} imageData
 * @returns {NormRect | null}
 */
export function detectObjectBoundingBox(imageData) {
  const scale = imageData.width > MAX_WIDTH ? MAX_WIDTH / imageData.width : 1;
  const w = Math.max(1, Math.round(imageData.width * scale));
  const h = Math.max(1, Math.round(imageData.height * scale));
  const gray = toGrayScaled(imageData, w, h);

  // Blur larger than pattern elements so texture averages out; object silhouette remains.
  const blurR = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  boxBlurInPlace(gray, w, h, blurR);

  const thr = otsuThreshold(gray);
  const area = w * h;
  const minArea = Math.max(64, (area * 0.02) | 0);
  const maxArea = (area * 0.85) | 0;

  /** Prefer the polarity whose largest blob is neither tiny nor almost-full-frame. */
  const dark = largestBlobBounds(gray, w, h, (v) => v < thr, minArea, maxArea);
  const light = largestBlobBounds(gray, w, h, (v) => v >= thr, minArea, maxArea);
  const best = pickBetter(dark, light, w, h);
  if (!best) return null;

  /* Padding size */
  return padNormRect(
    {
      nx: best.minX / w,
      ny: best.minY / h,
      nw: (best.maxX - best.minX + 1) / w,
      nh: (best.maxY - best.minY + 1) / h,
    },
    0.2
  );
}

/**
 * Expand a normalized rect by `padFrac` of its width/height on each side, clamped to the frame.
 * @param {NormRect} box
 * @param {number} [padFrac]
 * @returns {NormRect}
 */
export function padNormRect(box, padFrac = 0.2) {
  const padW = box.nw * padFrac;
  const padH = box.nh * padFrac;
  let nx = box.nx - padW;
  let ny = box.ny - padH;
  let nw = box.nw + 2 * padW;
  let nh = box.nh + 2 * padH;
  if (nx < 0) {
    nw += nx;
    nx = 0;
  }
  if (ny < 0) {
    nh += ny;
    ny = 0;
  }
  if (nx + nw > 1) nw = 1 - nx;
  if (ny + nh > 1) nh = 1 - ny;
  return {
    nx,
    ny,
    nw: Math.max(0, nw),
    nh: Math.max(0, nh),
  };
}

/**
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} scratch
 * @returns {NormRect | null}
 */
export function detectFromVideo(video, scratch) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || video.readyState < 2) return null;

  const scale = vw > MAX_WIDTH ? MAX_WIDTH / vw : 1;
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  return detectObjectBoundingBox(imageData);
}

/**
 * @param {{
 *   video: HTMLVideoElement,
 *   intervalMs?: number,
 *   onUpdate: (box: NormRect | null) => void,
 * }} opts
 */
export function createObjectDetectController(opts) {
  const video = opts.video;
  const intervalMs = opts.intervalMs ?? 1000;
  const onUpdate = opts.onUpdate;
  const scratch = document.createElement('canvas');

  let enabled = false;
  let timerId = /** @type {ReturnType<typeof setInterval> | null} */ (null);
  let running = false;
  /** @type {NormRect | null} */
  let lastBox = null;

  function tick() {
    if (!enabled || running) return;
    running = true;
    try {
      lastBox = detectFromVideo(video, scratch);
      onUpdate(lastBox);
    } finally {
      running = false;
    }
  }

  function startTimer() {
    if (timerId != null) return;
    tick();
    timerId = setInterval(tick, intervalMs);
  }

  function stopTimer() {
    if (timerId == null) return;
    clearInterval(timerId);
    timerId = null;
  }

  return {
    isEnabled() {
      return enabled;
    },
    getBox() {
      return lastBox;
    },
    setEnabled(on) {
      enabled = !!on;
      if (enabled) {
        startTimer();
      } else {
        stopTimer();
        lastBox = null;
        onUpdate(null);
      }
    },
    /** Call when camera starts so a running toggle resumes. */
    resume() {
      if (enabled) startTimer();
    },
    /** Call when camera stops or UI should pause detection. */
    pause() {
      stopTimer();
    },
  };
}

/**
 * @param {ImageData} src
 * @param {number} w
 * @param {number} h
 */
function toGrayScaled(src, w, h) {
  const out = new Uint8Array(w * h);
  const sw = src.width;
  const sh = src.height;
  const sdata = src.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * (sh / h)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * (sw / w)));
      const i = (sy * sw + sx) * 4;
      out[y * w + x] = (sdata[i] * 77 + sdata[i + 1] * 150 + sdata[i + 2] * 29) >> 8;
    }
  }
  return out;
}

/** Separable box blur, radius r (kernel 2r+1). */
function boxBlurInPlace(gray, w, h, r) {
  const tmp = new Uint8Array(gray.length);
  const span = 2 * r + 1;

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) {
      sum += gray[y * w + clamp(x, 0, w - 1)];
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = (sum / span) | 0;
      const leave = gray[y * w + clamp(x - r, 0, w - 1)];
      const enter = gray[y * w + clamp(x + r + 1, 0, w - 1)];
      sum += enter - leave;
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      sum += tmp[clamp(y, 0, h - 1) * w + x];
    }
    for (let y = 0; y < h; y++) {
      gray[y * w + x] = (sum / span) | 0;
      const leave = tmp[clamp(y - r, 0, h - 1) * w + x];
      const enter = tmp[clamp(y + r + 1, 0, h - 1) * w + x];
      sum += enter - leave;
    }
  }
}

/** @param {Uint8Array} gray */
function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      thr = t;
    }
  }
  return thr;
}

/**
 * @param {Uint8Array} gray
 * @param {number} w
 * @param {number} h
 * @param {(v: number) => boolean} isFg
 * @param {number} minArea
 * @param {number} maxArea
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, area: number } | null}
 */
function largestBlobBounds(gray, w, h, isFg, minArea, maxArea) {
  const visited = new Uint8Array(w * h);
  const stackX = new Int32Array(w * h);
  const stackY = new Int32Array(w * h);
  let best = null;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (visited[start] || !isFg(gray[start])) continue;

      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sp = 0;
      stackX[sp] = x;
      stackY[sp] = y;
      sp++;
      visited[start] = 1;

      while (sp > 0) {
        sp--;
        const cx = stackX[sp];
        const cy = stackY[sp];
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        if (cx > 0) {
          const i = cy * w + (cx - 1);
          if (!visited[i] && isFg(gray[i])) {
            visited[i] = 1;
            stackX[sp] = cx - 1;
            stackY[sp] = cy;
            sp++;
          }
        }
        if (cx + 1 < w) {
          const i = cy * w + (cx + 1);
          if (!visited[i] && isFg(gray[i])) {
            visited[i] = 1;
            stackX[sp] = cx + 1;
            stackY[sp] = cy;
            sp++;
          }
        }
        if (cy > 0) {
          const i = (cy - 1) * w + cx;
          if (!visited[i] && isFg(gray[i])) {
            visited[i] = 1;
            stackX[sp] = cx;
            stackY[sp] = cy - 1;
            sp++;
          }
        }
        if (cy + 1 < h) {
          const i = (cy + 1) * w + cx;
          if (!visited[i] && isFg(gray[i])) {
            visited[i] = 1;
            stackX[sp] = cx;
            stackY[sp] = cy + 1;
            sp++;
          }
        }
      }

      if (area < minArea || area > maxArea) continue;
      if (!best || area > best.area) {
        best = { minX, minY, maxX, maxY, area };
      }
    }
  }
  return best;
}

/**
 * @param {{ minX: number, minY: number, maxX: number, maxY: number, area: number } | null} a
 * @param {{ minX: number, minY: number, maxX: number, maxY: number, area: number } | null} b
 * @param {number} w
 * @param {number} h
 */
function pickBetter(a, b, w, h) {
  if (!a) return b;
  if (!b) return a;
  // Prefer blob that does not span nearly the full frame (background polarity).
  const spanA = (a.maxX - a.minX + 1) / w + (a.maxY - a.minY + 1) / h;
  const spanB = (b.maxX - b.minX + 1) / w + (b.maxY - b.minY + 1) / h;
  if (spanA < 1.7 && spanB >= 1.7) return a;
  if (spanB < 1.7 && spanA >= 1.7) return b;
  return a.area >= b.area ? a : b;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
