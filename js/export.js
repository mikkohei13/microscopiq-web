/**
 * PNG export with optional ~1 mm scale bar; File System Access API + download fallback.
 */

/**
 * @typedef {{ nx1: number, ny1: number, nx2: number, ny2: number }} NormSegment
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} pxPerMm
 */
export function drawScaleBarOnCanvas(ctx, width, height, pxPerMm) {
  const barLen = pxPerMm * 1;
  if (barLen < 4) return;
  const margin = Math.round(Math.min(width, height) * 0.02);
  const y = height - margin;
  const x0 = margin;
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
  const fontSize = Math.max(12, Math.round(height / 80));
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  const text = '~1 mm';
  ctx.strokeText(text, x0, y - fontSize * 0.5);
  ctx.fillText(text, x0, y - fontSize * 0.5);
  ctx.restore();
}

/**
 * @param {Blob} imageBlob
 * @param {number | null} pxPerMm Source pixels per mm.
 * @param {{ withMeasurements?: boolean, measurements?: NormSegment[] }} [options]
 * @returns {Promise<Blob>}
 */
export async function composePngWithScaleBar(imageBlob, pxPerMm, options = {}) {
  const { withMeasurements = false, measurements = [] } = options;
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
    drawScaleBarOnCanvas(ctx, width, height, pxPerMm);
  }
  if (withMeasurements && measurements.length > 0) {
    drawMeasurementsOnCanvas(ctx, width, height, measurements, pxPerMm);
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
 */
function drawMeasurementsOnCanvas(ctx, width, height, measurements, pxPerMm) {
  for (const seg of measurements) {
    const x1 = seg.nx1 * width;
    const y1 = seg.ny1 * height;
    const x2 = seg.nx2 * width;
    const y2 = seg.ny2 * height;
    ctx.save();
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = Math.max(2, Math.round(height / 600));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (pxPerMm != null && pxPerMm > 0) {
      const srcPx = Math.hypot((seg.nx2 - seg.nx1) * width, (seg.ny2 - seg.ny1) * height);
      const mm = srcPx / pxPerMm;
      const label = `${mm.toFixed(2)} mm`;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const fontSize = Math.max(13, Math.round(height / 85));
      const pad = Math.max(4, Math.round(fontSize * 0.28));
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      const boxW = tw + pad * 2;
      const boxH = Math.round(fontSize * 1.35);
      const boxX = mx - boxW / 2;
      const boxY = my - boxH - Math.max(6, Math.round(fontSize * 0.2));
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = '#b6f7c4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, mx, boxY + boxH / 2);
    }
    ctx.restore();
  }
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

