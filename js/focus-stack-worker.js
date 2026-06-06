/**
 * Focus stack: OpenCV alignment (homography) + Laplacian-based weighted fusion.
 * Classic worker (no module) for OpenCV UMD + WASM.
 */

/* global cv */

/** @type {boolean} */
let opencvReady = false;
/** @type {(() => void)[]} */
const readyWaiters = [];

const OPENCV_JS_URL =
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js';

function loadOpenCv() {
  try {
    // eslint-disable-next-line no-undef
    importScripts(OPENCV_JS_URL);
  } catch (e) {
    postMessage({
      type: 'error',
      message: `Failed to load OpenCV.js: ${e && e.message ? e.message : String(e)}`,
    });
    return;
  }
  if (typeof cv === 'undefined') {
    postMessage({ type: 'error', message: 'OpenCV global missing after importScripts' });
    return;
  }
  cv['onRuntimeInitialized'] = () => {
    opencvReady = true;
    postMessage({ type: 'opencvReady' });
    for (const w of readyWaiters.splice(0)) w();
  };
}

loadOpenCv();

/**
 * @param {() => void} fn
 */
function whenOpencvReady(fn) {
  if (opencvReady) fn();
  else readyWaiters.push(fn);
}

/**
 * @param {unknown} e
 */
function postErr(msg) {
  postMessage({ type: 'error', message: msg });
}

/**
 * TechStark / many wasm builds omit imgcodecs — use browser PNG decode when needed.
 * @param {Uint8Array} u8
 * @returns {Promise<cv.Mat>} BGR uint8
 */
async function decodePngUint8ToBgrMat(u8) {
  if (typeof cv.imdecode === 'function') {
    const mat = cv.imdecode(u8, cv.IMREAD_COLOR);
    if (!mat || mat.empty()) {
      throw new Error('imdecode returned empty');
    }
    return mat;
  }
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      'PNG decode needs createImageBitmap and OffscreenCanvas (or OpenCV built with imdecode)'
    );
  }
  const blob = new Blob([u8], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not get 2D context for PNG decode');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imgData = ctx.getImageData(0, 0, w, h);
  let rgba;
  if (typeof cv.matFromImageData === 'function') {
    rgba = cv.matFromImageData(imgData);
  } else {
    rgba = new cv.Mat(h, w, cv.CV_8UC4);
    rgba.data.set(imgData.data);
  }
  const bgr = new cv.Mat();
  cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR);
  rgba.delete();
  return bgr;
}

/**
 * @param {cv.Mat} out8 CV_8UC3 BGR
 * @returns {Promise<ArrayBuffer>}
 */
async function encodeBgrMatToPngArrayBuffer(out8) {
  if (typeof cv.imencode === 'function') {
    const outVec = new cv.Mat();
    const ok = cv.imencode('.png', out8, outVec);
    if (!ok || outVec.empty()) {
      outVec.delete();
      throw new Error('imencode failed');
    }
    const encBytes = outVec.data;
    const byteLen =
      encBytes && typeof encBytes.length === 'number'
        ? encBytes.length
        : outVec.rows * Math.max(1, outVec.cols) * outVec.elemSize();
    const buf = new Uint8Array(byteLen);
    buf.set(new Uint8Array(encBytes.buffer, encBytes.byteOffset, byteLen));
    outVec.delete();
    return buf.buffer;
  }
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('PNG encode needs OffscreenCanvas or OpenCV built with imencode');
  }
  const rgba = new cv.Mat();
  cv.cvtColor(out8, rgba, cv.COLOR_BGR2RGBA);
  const w = rgba.cols;
  const h = rgba.rows;
  const nBytes = w * h * 4;
  const view = new Uint8Array(rgba.data.buffer, rgba.data.byteOffset, nBytes);
  const bytes = new Uint8ClampedArray(nBytes);
  bytes.set(view);
  rgba.delete();
  const oc = new OffscreenCanvas(w, h);
  const ctx = oc.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context for PNG encode');
  }
  ctx.putImageData(new ImageData(bytes, w, h), 0, 0);
  const blob = await oc.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

/**
 * @param {cv.Mat} bgr8
 * @param {cv.Mat} outGray8
 */
function bgrToGray8(bgr8, outGray8) {
  cv.cvtColor(bgr8, outGray8, cv.COLOR_BGR2GRAY);
}

/**
 * @param {cv.Mat} gray8
 * @param {cv.Mat} out32f
 */
function laplacianSharpness(gray8, out32f) {
  const lap16 = new cv.Mat();
  const lapAbs8 = new cv.Mat();
  cv.Laplacian(gray8, lap16, cv.CV_16S, 3, 1, 0);
  cv.convertScaleAbs(lap16, lapAbs8);
  lap16.delete();
  lapAbs8.convertTo(out32f, cv.CV_32F, 1.0 / 255.0);
  cv.multiply(out32f, out32f, out32f);
  lapAbs8.delete();
}

/**
 * @param {cv.KeyPointVector} kpv
 * @param {number} i
 */
function kpPt(kpv, i) {
  const kp = kpv.get(i);
  return { x: kp.pt.x, y: kp.pt.y };
}

/**
 * OpenCV.js builds differ: some use `cv.ORB_create()`, TechStark uses `new cv.ORB()`.
 * @returns {any} ORB Feature2D instance
 */
function createOrbDetector() {
  if (typeof cv.ORB_create === 'function') {
    return cv.ORB_create(1200);
  }
  if (typeof cv.ORB === 'function') {
    return new cv.ORB(1200);
  }
  throw new Error(
    'ORB is not available (expected cv.ORB or cv.ORB_create). This OpenCV build may omit features2d.'
  );
}

/**
 * ORB + homography from `mov` coordinates to `ref` coordinates (p_ref ≈ H * p_mov).
 * @param {cv.Mat} grayMov8
 * @param {cv.Mat} grayRef8
 * @returns {cv.Mat | null} 3x3 CV_64F or null
 */
function estimateHomographyMovToRef(grayMov8, grayRef8) {
  const orb = createOrbDetector();
  const kpM = new cv.KeyPointVector();
  const kpR = new cv.KeyPointVector();
  const desM = new cv.Mat();
  const desR = new cv.Mat();
  const maskNone = new cv.Mat();
  orb.detectAndCompute(grayMov8, maskNone, kpM, desM);
  orb.detectAndCompute(grayRef8, maskNone, kpR, desR);
  maskNone.delete();
  if (desM.rows < 8 || desR.rows < 8 || desM.cols < 1 || desR.cols < 1) {
    kpM.delete();
    kpR.delete();
    desM.delete();
    desR.delete();
    return null;
  }

  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  bf.knnMatch(desM, desR, knn, 2);
  bf.delete();
  desM.delete();
  desR.delete();

  /** @type {{ q: number, t: number, dist: number }[]} */
  const good = [];
  for (let i = 0; i < knn.size(); i += 1) {
    const pair = knn.get(i);
    if (pair.size() < 2) continue;
    const m0 = pair.get(0);
    const m1 = pair.get(1);
    if (m0.distance < 0.75 * m1.distance) {
      good.push({ q: m0.queryIdx, t: m0.trainIdx, dist: m0.distance });
    }
  }
  knn.delete();

  if (good.length < 8) {
    kpM.delete();
    kpR.delete();
    return null;
  }

  good.sort((a, b) => a.dist - b.dist);
  const take = Math.min(200, good.length);
  const srcPts = new cv.Mat(take, 1, cv.CV_32FC2);
  const dstPts = new cv.Mat(take, 1, cv.CV_32FC2);
  const srcData = srcPts.data32F;
  const dstData = dstPts.data32F;
  for (let i = 0; i < take; i += 1) {
    const g = good[i];
    const pm = kpPt(kpM, g.q);
    const pr = kpPt(kpR, g.t);
    srcData[i * 2] = pm.x;
    srcData[i * 2 + 1] = pm.y;
    dstData[i * 2] = pr.x;
    dstData[i * 2 + 1] = pr.y;
  }
  kpM.delete();
  kpR.delete();

  const inl = new cv.Mat();
  const H = cv.findHomography(srcPts, dstPts, cv.RANSAC, 2.5, inl, 2000, 0.995);
  srcPts.delete();
  dstPts.delete();
  inl.delete();

  if (!H || H.rows !== 3 || H.cols !== 3) {
    if (H) H.delete();
    return null;
  }
  return H;
}

/**
 * @param {Uint8Array[]} pngChunks
 */
async function processStack(pngChunks) {
  const n = pngChunks.length;
  if (n < 3 || n > 15) {
    postErr('Need between 3 and 15 frames.');
    return;
  }

  postMessage({ type: 'progress', phase: 'decode' });

  /** @type {cv.Mat[]} */
  const bgr = [];
  try {
    for (let i = 0; i < n; i += 1) {
      const mat = await decodePngUint8ToBgrMat(pngChunks[i]);
      bgr.push(mat);
    }
  } catch (e) {
    for (const m of bgr) m.delete();
    postErr(e && e.message ? e.message : String(e));
    return;
  }

  const w0 = bgr[0].cols;
  const h0 = bgr[0].rows;
  for (let i = 1; i < n; i += 1) {
    if (bgr[i].cols !== w0 || bgr[i].rows !== h0) {
      const resized = new cv.Mat();
      cv.resize(bgr[i], resized, new cv.Size(w0, h0), 0, 0, cv.INTER_LINEAR);
      bgr[i].delete();
      bgr[i] = resized;
    }
  }

  const maxSide = Math.max(w0, h0);
  const maxProc = 1600;
  let scale = 1;
  if (maxSide > maxProc) scale = maxProc / maxSide;

  const W = Math.max(1, Math.round(w0 * scale));
  const H = Math.max(1, Math.round(h0 * scale));
  const procSize = new cv.Size(W, H);

  /** @type {cv.Mat[]} */
  const bgrS = [];
  for (let i = 0; i < n; i += 1) {
    const s = new cv.Mat();
    cv.resize(bgr[i], s, procSize, 0, 0, cv.INTER_AREA);
    bgrS.push(s);
  }
  for (const m of bgr) m.delete();

  const refIdx = Math.floor(n / 2);
  const grayRef = new cv.Mat();
  bgrToGray8(bgrS[refIdx], grayRef);

  postMessage({ type: 'progress', phase: 'align' });

  /** @type {cv.Mat[]} */
  const aligned = [];
  for (let i = 0; i < n; i += 1) {
    if (i === refIdx) {
      aligned.push(bgrS[i].clone());
      continue;
    }
    const grayM = new cv.Mat();
    bgrToGray8(bgrS[i], grayM);
    let H = estimateHomographyMovToRef(grayM, grayRef);
    grayM.delete();
    if (!H) {
      H = cv.Mat.eye(3, 3, cv.CV_64F);
    }
    const warped = new cv.Mat();
    cv.warpPerspective(
      bgrS[i],
      warped,
      H,
      procSize,
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE
    );
    H.delete();
    aligned.push(warped);
  }
  grayRef.delete();
  for (const m of bgrS) m.delete();

  postMessage({ type: 'progress', phase: 'fuse' });

  let featherK = Math.round(Math.min(W, H) * 0.035);
  featherK = Math.min(51, Math.max(3, featherK));
  if (featherK % 2 === 0) featherK += 1;
  const featherSigma = featherK / 3;

  /** @type {cv.Mat[]} */
  const weights = [];
  const grayTmp = new cv.Mat();
  const wRaw = new cv.Mat();
  const wBlur = new cv.Mat();
  const ksz = new cv.Size(featherK, featherK);

  for (let i = 0; i < n; i += 1) {
    bgrToGray8(aligned[i], grayTmp);
    laplacianSharpness(grayTmp, wRaw);
    cv.GaussianBlur(wRaw, wBlur, ksz, featherSigma, featherSigma, cv.BORDER_REPLICATE);
    weights.push(wBlur.clone());
  }
  grayTmp.delete();
  wRaw.delete();
  wBlur.delete();

  const sumW = new cv.Mat(H, W, cv.CV_32F, new cv.Scalar(0));
  for (let i = 0; i < n; i += 1) {
    cv.add(sumW, weights[i], sumW);
  }

  const eps = new cv.Mat(H, W, cv.CV_32F, new cv.Scalar(1e-4));
  cv.add(sumW, eps, sumW);
  eps.delete();

  const accB = new cv.Mat(H, W, cv.CV_32F, new cv.Scalar(0));
  const accG = new cv.Mat(H, W, cv.CV_32F, new cv.Scalar(0));
  const accR = new cv.Mat(H, W, cv.CV_32F, new cv.Scalar(0));

  const f3 = new cv.Mat();
  const wb = new cv.Mat();
  const wg = new cv.Mat();
  const wr = new cv.Mat();

  for (let i = 0; i < n; i += 1) {
    aligned[i].convertTo(f3, cv.CV_32FC3, 1.0 / 255.0);
    const chans = new cv.MatVector();
    cv.split(f3, chans);
    const b0 = chans.get(0);
    const g0 = chans.get(1);
    const r0 = chans.get(2);
    cv.multiply(b0, weights[i], wb);
    cv.multiply(g0, weights[i], wg);
    cv.multiply(r0, weights[i], wr);
    cv.add(accB, wb, accB);
    cv.add(accG, wg, accG);
    cv.add(accR, wr, accR);
    b0.delete();
    g0.delete();
    r0.delete();
    chans.delete();
  }
  f3.delete();
  wb.delete();
  wg.delete();
  wr.delete();

  cv.divide(accB, sumW, accB);
  cv.divide(accG, sumW, accG);
  cv.divide(accR, sumW, accR);

  const merged = new cv.Mat();
  const mv = new cv.MatVector();
  mv.push_back(accB);
  mv.push_back(accG);
  mv.push_back(accR);
  cv.merge(mv, merged);
  mv.delete();
  accB.delete();
  accG.delete();
  accR.delete();
  sumW.delete();
  for (const w of weights) w.delete();
  for (const a of aligned) a.delete();

  const out8 = new cv.Mat();
  merged.convertTo(out8, cv.CV_8UC3, 255.0, 0);
  merged.delete();

  let pngAb;
  try {
    pngAb = await encodeBgrMatToPngArrayBuffer(out8);
  } catch (e) {
    out8.delete();
    postErr(e && e.message ? e.message : String(e));
    return;
  }
  out8.delete();

  postMessage({ type: 'progress', phase: 'done' });
  postMessage({ type: 'result', buffer: pngAb }, [pngAb]);
}

self.onmessage = (ev) => {
  const d = ev.data;
  if (!d || typeof d !== 'object') return;

  if (d.type === 'process' && Array.isArray(d.buffers)) {
    whenOpencvReady(() => {
      const chunks = d.buffers.map((ab) => new Uint8Array(ab));
      void processStack(chunks).catch((e) => {
        postErr(e && e.message ? e.message : String(e));
      });
    });
    return;
  }
};
