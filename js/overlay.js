/**
 * Video preview uses object-fit: contain. Coordinates are normalized to the
 * fitted video content rectangle (0–1 within that rect).
 */

/**
 * @param {HTMLElement} container
 * @param {HTMLVideoElement} video
 * @returns {{ left: number, top: number, width: number, height: number, videoWidth: number, videoHeight: number }}
 */
export function getVideoContentRect(container, video) {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    return {
      left: 0,
      top: 0,
      width: cw,
      height: ch,
      videoWidth: vw || 0,
      videoHeight: vh || 0,
    };
  }
  const scale = Math.min(cw / vw, ch / vh);
  const width = vw * scale;
  const height = vh * scale;
  const left = (cw - width) / 2;
  const top = (ch - height) / 2;
  return { left, top, width, height, videoWidth: vw, videoHeight: vh };
}

/**
 * Match canvas bitmap size to container; drawing uses CSS pixels.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 */
export function syncCanvasSize(canvas, container) {
  const w = container.clientWidth;
  const h = container.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return ctx;
}

/**
 * @param {number} clientX
 * @param {number} clientY
 * @param {HTMLElement} container
 * @param {HTMLVideoElement} video
 * @returns {{ nx: number, ny: number, inside: boolean }}
 */
export function clientToNormalized(clientX, clientY, container, video) {
  const rect = container.getBoundingClientRect();
  const vr = getVideoContentRect(container, video);
  const x = clientX - rect.left - vr.left;
  const y = clientY - rect.top - vr.top;
  const nx = vr.width > 0 ? x / vr.width : 0;
  const ny = vr.height > 0 ? y / vr.height : 0;
  const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  return {
    nx: clamp(nx, 0, 1),
    ny: clamp(ny, 0, 1),
    inside,
  };
}

/**
 * Distance in source (camera) pixels between two normalized points.
 * @param {number} nx1
 * @param {number} ny1
 * @param {number} nx2
 * @param {number} ny2
 * @param {HTMLVideoElement} video
 */
export function normDistanceToSourcePixels(nx1, ny1, nx2, ny2, video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return 0;
  const dx = (nx2 - nx1) * vw;
  const dy = (ny2 - ny1) * vh;
  return Math.hypot(dx, dy);
}

/**
 * Display pixels per mm on the overlay (for drawing ~1 mm reference).
 * @param {number} pxPerMm source pixels per mm
 * @param {ReturnType<typeof getVideoContentRect>} vr
 */
export function mmToOverlayPixels(pxPerMm, mm, vr) {
  if (!vr.videoWidth || !vr.width) return 0;
  const scale = vr.width / vr.videoWidth;
  return pxPerMm * mm * scale;
}

/**
 * @param {number} nx
 * @param {number} ny
 * @param {HTMLElement} container
 * @param {HTMLVideoElement} video
 * @returns {{ x: number, y: number }}
 */
export function normalizedToClientPixels(nx, ny, container, video) {
  const vr = getVideoContentRect(container, video);
  return {
    x: vr.left + nx * vr.width,
    y: vr.top + ny * vr.height,
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLElement} container
 * @param {HTMLVideoElement} video
 */
export function setupOverlayResize(canvas, container, video, onLayout) {
  const ro = new ResizeObserver(() => {
    syncCanvasSize(canvas, container);
    if (typeof onLayout === 'function') onLayout();
  });
  ro.observe(container);
  syncCanvasSize(canvas, container);
  return () => ro.disconnect();
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
