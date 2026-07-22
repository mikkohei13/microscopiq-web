/**
 * Pure-JS preprocess: grayscale → box blur → Otsu (inverted binary).
 */

/**
 * @typedef {Object} BinaryImage
 * @property {Uint8Array} data  255 = foreground (dark ink), 0 = background
 * @property {number} width
 * @property {number} height
 * @property {number} scale  processed→source scale (coords * scale → source px)
 */

/**
 * @param {ImageData} imageData
 * @param {{ maxWidth?: number }} [opts]
 * @returns {{ binary: BinaryImage }}
 */
export function preprocess(imageData, opts = {}) {
  const maxWidth = opts.maxWidth ?? 960;
  const scale = imageData.width > maxWidth ? maxWidth / imageData.width : 1;
  const w = Math.max(1, Math.round(imageData.width * scale));
  const h = Math.max(1, Math.round(imageData.height * scale));

  const gray = toGrayScaled(imageData, w, h);
  boxBlurInPlace(gray, w, h, 2);
  const thr = otsuThreshold(gray);
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = gray[i] < thr ? 255 : 0;
  }

  return {
    binary: { data: binary, width: w, height: h, scale: imageData.width / w },
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
  const hist = new Float64Array(256);
  const n = gray.length;
  for (let i = 0; i < n; i++) hist[gray[i]]++;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      thr = t;
    }
  }
  return thr;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
