/**
 * PNG export with optional ~1 mm scale bar; File System Access API + download fallback.
 */

import { computeMeasurementLabelPlacements } from './measurement-label-layout.js';

/**
 * @typedef {{ nx1: number, ny1: number, nx2: number, ny2: number }} NormSegment
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} pxPerMm
 * @param {{ nx: number, ny: number } | null | undefined} [anchor] Normalized left baseline (0–1); omit for default corner placement.
 * @param {'manual' | 'auto' | null | undefined} [mode]
 */
export function drawScaleBarOnCanvas(ctx, width, height, pxPerMm, anchor, mode) {
  const barLen = pxPerMm * 1;
  if (barLen < 4) return;
  const margin = Math.round(Math.min(width, height) * 0.02);
  const fontSize = Math.max(12, Math.round(height / 80));
  let x0;
  let y;
  if (
    anchor &&
    typeof anchor.nx === 'number' &&
    typeof anchor.ny === 'number' &&
    Number.isFinite(anchor.nx) &&
    Number.isFinite(anchor.ny)
  ) {
    x0 = anchor.nx * width;
    y = anchor.ny * height;
    const labelClearance = fontSize * 1.1;
    const yMin = margin + labelClearance;
    const yMax = height - margin;
    x0 = clamp(x0, margin, width - margin - barLen);
    y = clamp(y, yMin, yMax);
  } else {
    y = height - margin;
    x0 = margin;
  }
  const x1 = x0 + barLen;
  ctx.save();
  ctx.lineWidth = Math.max(2, Math.round(height / 400));
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, ctx.lineWidth - 1);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  const text = mode === 'manual' || mode === 'auto' ? `~1 mm ${mode}` : '~1 mm';
  ctx.strokeText(text, x0, y - fontSize * 0.5);
  ctx.fillText(text, x0, y - fontSize * 0.5);
  ctx.restore();
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * @param {Blob} imageBlob
 * @param {number | null} pxPerMm Source pixels per mm.
 * @param {{ withMeasurements?: boolean, measurements?: NormSegment[], measurementRefIndex?: number, measurementRelative?: boolean, scaleBarAnchor?: { nx: number, ny: number } | null, calibrationMode?: 'manual' | 'auto' | null }} [options]
 * @returns {Promise<Blob>}
 */
export async function composePngWithScaleBar(imageBlob, pxPerMm, options = {}) {
  const {
    withMeasurements = false,
    measurements = [],
    measurementRefIndex = -1,
    measurementRelative = false,
    scaleBarAnchor = null,
    calibrationMode = null,
  } = options;
  const bitmap = await createImageBitmap(imageBlob);
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  if (pxPerMm != null && pxPerMm > 0) {
    drawScaleBarOnCanvas(ctx, width, height, pxPerMm, scaleBarAnchor, calibrationMode);
  }
  if (withMeasurements && measurements.length > 0) {
    drawMeasurementsOnCanvas(
      ctx,
      width,
      height,
      measurements,
      pxPerMm,
      measurementRelative,
      measurementRefIndex
    );
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('PNG encode failed'));
      },
      'image/png',
      1
    );
  });
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {NormSegment[]} measurements
 * @param {number | null} pxPerMm
 * @param {boolean} [relative]
 * @param {number} [refIndex]
 */
function drawMeasurementsOnCanvas(
  ctx,
  width,
  height,
  measurements,
  pxPerMm,
  relative = false,
  refIndex = -1
) {
  const lineWidth = Math.max(2, Math.round(height / 600));
  const refIdx =
    refIndex >= 0 && refIndex < measurements.length ? refIndex : -1;
  const refSeg = refIdx >= 0 ? measurements[refIdx] : null;
  const refPx =
    refSeg != null
      ? Math.hypot(
          (refSeg.nx2 - refSeg.nx1) * width,
          (refSeg.ny2 - refSeg.ny1) * height
        )
      : 0;
  const showRelativeLabels = relative && refSeg != null && refPx > 1e-9;

  for (let i = 0; i < measurements.length; i += 1) {
    const seg = measurements[i];
    const x1 = seg.nx1 * width;
    const y1 = seg.ny1 * height;
    const x2 = seg.nx2 * width;
    const y2 = seg.ny2 * height;
    const isRelativeRef = showRelativeLabels && i === refIdx;
    ctx.save();
    ctx.strokeStyle = isRelativeRef ? '#f97316' : '#4ade80';
    ctx.lineWidth = isRelativeRef ? lineWidth + 1 : lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  const canLabelAbsolute =
    !relative && pxPerMm != null && pxPerMm > 0 && measurements.length > 0;
  if (!showRelativeLabels && !canLabelAbsolute) return;

  const fontSize = Math.max(13, Math.round(height / 85));
  const pad = Math.max(4, Math.round(fontSize * 0.28));
  const boxH = Math.round(fontSize * 1.35);
  const font = `${fontSize}px system-ui, sans-serif`;
  ctx.save();
  ctx.font = font;

  /** @type {{ midX: number, midY: number, vx: number, vy: number, tw: number, pad: number, boxH: number }[]} */
  const labelItems = [];
  /** @type {string[]} */
  const labelTexts = [];
  /** @type {boolean[]} */
  const labelIsRef = [];

  for (let i = 0; i < measurements.length; i += 1) {
    const seg = measurements[i];
    const x1 = seg.nx1 * width;
    const y1 = seg.ny1 * height;
    const x2 = seg.nx2 * width;
    const y2 = seg.ny2 * height;
    const srcPx = Math.hypot((seg.nx2 - seg.nx1) * width, (seg.ny2 - seg.ny1) * height);
    let text;
    let isRefLabel = false;
    if (showRelativeLabels) {
      if (i === refIdx) {
        text = '1';
        isRefLabel = true;
      } else {
        text = (srcPx / refPx).toFixed(2);
      }
    } else {
      const mm = srcPx / pxPerMm;
      text = `${mm.toFixed(2)} mm`;
    }
    const tw = ctx.measureText(text).width;
    labelTexts.push(text);
    labelIsRef.push(isRefLabel);
    labelItems.push({
      midX: (x1 + x2) / 2,
      midY: (y1 + y2) / 2,
      vx: x2 - x1,
      vy: y2 - y1,
      tw,
      pad,
      boxH,
    });
  }

  const placements = computeMeasurementLabelPlacements(labelItems);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < placements.length; i += 1) {
    const pl = placements[i];
    const isRefLabel = labelIsRef[i];
    ctx.fillStyle = isRefLabel
      ? 'rgba(124, 45, 18, 0.88)'
      : 'rgba(0,0,0,0.65)';
    ctx.fillRect(pl.cx - pl.boxW / 2, pl.cy - boxH / 2, pl.boxW, boxH);
    ctx.fillStyle = isRefLabel ? '#ffedd5' : '#b6f7c4';
    ctx.fillText(labelTexts[i], pl.cx, pl.cy);
  }
  ctx.restore();
}

/**
 * Crop an image blob to a normalized rect (0–1 of full frame). Returns PNG.
 * @param {Blob} imageBlob
 * @param {{ nx: number, ny: number, nw: number, nh: number }} box
 * @returns {Promise<Blob>}
 */
export async function cropBlobToNormRect(imageBlob, box) {
  const bitmap = await createImageBitmap(imageBlob);
  const width = bitmap.width;
  const height = bitmap.height;
  let sx = Math.round(box.nx * width);
  let sy = Math.round(box.ny * height);
  let sw = Math.round(box.nw * width);
  let sh = Math.round(box.nh * height);
  sx = clamp(sx, 0, Math.max(0, width - 1));
  sy = clamp(sy, 0, Math.max(0, height - 1));
  sw = clamp(sw, 1, width - sx);
  sh = clamp(sh, 1, height - sy);

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas unsupported');
  }
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('PNG encode failed'));
      },
      'image/png',
      1
    );
  });
}

/**
 * @returns {string}
 */
export function timestampFilename() {
  const d = new Date();
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const SSS = pad(d.getMilliseconds(), 3);
  return `${yyyy}${MM}${dd}_${HH}${mm}${ss}_${SSS}.png`;
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * @param {FileSystemDirectoryHandle | null | undefined} dirHandle
 * @param {Blob} blob
 * @param {string} filename
 */
export async function saveBlobToDirectory(dirHandle, blob, filename) {
  if (!dirHandle || !dirHandle.getFileHandle) {
    downloadBlob(blob, filename);
    return false;
  }
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

