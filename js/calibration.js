/**
 * Calibration: yellow line with draggable handles, pxPerMm, ~1 mm reference line.
 */

import {
  clientToNormalized,
  getVideoContentRect,
  mmToOverlayPixels,
  normDistanceToSourcePixels,
  normalizedToClientPixels,
} from './overlay.js';

const HANDLE_RADIUS = 10;

/** @typedef {'inactive' | 'adjusting' | 'calibrated'} CalibrationPhase */
/** @typedef {'manual' | 'auto' | null} CalibrationSource */

export function createCalibrationController(options) {
  const {
    container,
    video,
    scaleBarLabel,
    onStateChange,
    onRedraw,
  } = options;

  /** @type {CalibrationPhase} */
  let phase = 'inactive';
  /** @type {CalibrationSource} */
  let source = null;
  /** @type {number} */
  let knownMm = 10;
  /** @type {{ nx1: number, ny1: number, nx2: number, ny2: number }} */
  let line = { nx1: 0.35, ny1: 0.5, nx2: 0.65, ny2: 0.5 };
  /** @type {number | null} source pixels per mm */
  let pxPerMm = null;

  /** Left end of ~1 mm bar in normalized video-content coords (0–1). */
  /** @type {{ nx: number, ny: number } | null} */
  let scaleBarAnchor = null;
  let scaleBarDragging = false;
  /** @type {number | null} */
  let scaleBarPointerId = null;

  let dragTarget = /** @type {'a' | 'b' | null} */ (null);

  function setPhase(p) {
    phase = p;
    if (typeof onStateChange === 'function') onStateChange();
  }

  function resetLineToCenter() {
    line = { nx1: 0.4, ny1: 0.5, nx2: 0.6, ny2: 0.5 };
  }

  /**
   * @param {number} mm
   */
  function startAdjusting(mm) {
    knownMm = clamp(mm, 1, 100);
    resetLineToCenter();
    setPhase('adjusting');
  }

  function cancel() {
    dragTarget = null;
    if (phase === 'adjusting') {
      setPhase('inactive');
    }
  }

  function finish() {
    if (phase !== 'adjusting') return;
    const d = normDistanceToSourcePixels(
      line.nx1,
      line.ny1,
      line.nx2,
      line.ny2,
      video
    );
    if (d < 1 || knownMm <= 0) {
      setPhase('inactive');
      return;
    }
    pxPerMm = d / knownMm;
    source = 'manual';
    placeDefaultScaleBarAnchor();
    setPhase('calibrated');
  }

  /**
   * Apply scale from auto-calibration (after user approval).
   * @param {number} px
   */
  function applyAuto(px) {
    if (!(px > 0)) return;
    pxPerMm = px;
    source = 'auto';
    placeDefaultScaleBarAnchor();
    setPhase('calibrated');
  }

  function placeDefaultScaleBarAnchor() {
    if (pxPerMm == null) return;
    const vr = getVideoContentRect(container, video);
    const len = mmToOverlayPixels(pxPerMm, 1, vr);
    const margin = 16;
    if (!vr.width || !vr.height || len < 4) {
      scaleBarAnchor = { nx: 0.03, ny: 0.92 };
      return;
    }
    const nxMax = Math.max(0, 1 - len / vr.width);
    const nxLeft = clamp(margin / vr.width, 0, nxMax);
    const nyBase = clamp((vr.height - margin) / vr.height, 0, 1);
    scaleBarAnchor = { nx: nxLeft, ny: nyBase };
  }

  function clearCalibration() {
    pxPerMm = null;
    source = null;
    scaleBarAnchor = null;
    scaleBarDragging = false;
    scaleBarPointerId = null;
    hideScaleBarLabel();
    setPhase('inactive');
  }

  function getPxPerMm() {
    return pxPerMm;
  }

  function getPhase() {
    return phase;
  }

  /** @returns {CalibrationSource} */
  function getSource() {
    return source;
  }

  function getKnownMm() {
    return knownMm;
  }

  /**
   * Normalized left baseline for the ~1 mm bar on exported images (matches overlay space).
   * @returns {{ nx: number, ny: number } | null}
   */
  function getScaleBarAnchor() {
    if (phase !== 'calibrated' || pxPerMm == null || !scaleBarAnchor) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const barLen = pxPerMm * 1;
    if (barLen < 4) return null;
    const nxMax = Math.max(0, 1 - barLen / vw);
    return {
      nx: clamp(scaleBarAnchor.nx, 0, nxMax),
      ny: clamp(scaleBarAnchor.ny, 0, 1),
    };
  }

  /**
   * If the ~1 mm bar is not fully inside `box`, move it to the box bottom-left.
   * No-op while dragging or when already inside. Returns true if the anchor moved.
   * @param {{ nx: number, ny: number, nw: number, nh: number }} box
   * @returns {boolean}
   */
  function ensureScaleBarInsideBox(box) {
    if (phase !== 'calibrated' || pxPerMm == null || !scaleBarAnchor) return false;
    if (scaleBarDragging) return false;
    if (!box || box.nw <= 0 || box.nh <= 0) return false;
    const vw = video.videoWidth;
    if (!vw) return false;
    const barLenNorm = pxPerMm / vw;
    if (!(barLenNorm > 0)) return false;

    const nxMax = Math.max(0, 1 - barLenNorm);
    const nxLeft = clamp(scaleBarAnchor.nx, 0, nxMax);
    const nyBase = clamp(scaleBarAnchor.ny, 0, 1);
    const nxRight = nxLeft + barLenNorm;
    const boxRight = box.nx + box.nw;
    const boxBottom = box.ny + box.nh;
    const fullyInside =
      nxLeft >= box.nx &&
      nxRight <= boxRight &&
      nyBase >= box.ny &&
      nyBase <= boxBottom;
    if (fullyInside) return false;

    const marginX = Math.min(0.02, box.nw * 0.08);
    const marginY = Math.min(0.02, box.nh * 0.08);
    const nxMaxInBox = Math.max(box.nx, boxRight - barLenNorm);
    const nx = clamp(box.nx + marginX, box.nx, nxMaxInBox);
    const ny = clamp(boxBottom - marginY, box.ny, boxBottom);
    scaleBarAnchor = { nx: clamp(nx, 0, nxMax), ny: clamp(ny, 0, 1) };
    return true;
  }

  function isScaleBarDragging() {
    return scaleBarDragging;
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function hitTestScaleBar(clientX, clientY) {
    if (phase !== 'calibrated' || pxPerMm == null || !scaleBarAnchor) return false;
    const vr = getVideoContentRect(container, video);
    const len = mmToOverlayPixels(pxPerMm, 1, vr);
    if (len < 4 || !vr.width) return false;
    const nxMax = Math.max(0, 1 - len / vr.width);
    const nxLeft = clamp(scaleBarAnchor.nx, 0, nxMax);
    const nyBase = clamp(scaleBarAnchor.ny, 0, 1);
    const x0 = vr.left + nxLeft * vr.width;
    const y = vr.top + nyBase * vr.height;
    const x1 = x0 + len;
    const slopY = 14;
    const padX = 8;
    if (clientX < x0 - padX || clientX > x1 + padX) return false;
    if (clientY < y - slopY - 20 || clientY > y + slopY) return false;
    return true;
  }

  /**
   * @param {PointerEvent} e
   * @returns {boolean} true if handled
   */
  function tryScaleBarPointerDown(e) {
    if (phase !== 'calibrated' || pxPerMm == null || !scaleBarAnchor) return false;
    if (!hitTestScaleBar(e.clientX, e.clientY)) return false;
    scaleBarDragging = true;
    scaleBarPointerId = e.pointerId;
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    return true;
  }

  /**
   * @param {PointerEvent} e
   * @returns {boolean} true if handled
   */
  function tryScaleBarPointerMove(e) {
    if (!scaleBarDragging || e.pointerId !== scaleBarPointerId || pxPerMm == null) {
      return false;
    }
    const vr = getVideoContentRect(container, video);
    const len = mmToOverlayPixels(pxPerMm, 1, vr);
    if (!vr.width || len < 4) return true;
    const { nx, ny } = clientToNormalized(e.clientX, e.clientY, container, video);
    const nxMax = Math.max(0, 1 - len / vr.width);
    scaleBarAnchor = { nx: clamp(nx, 0, nxMax), ny: clamp(ny, 0, 1) };
    e.preventDefault();
    if (typeof onRedraw === 'function') onRedraw();
    return true;
  }

  /**
   * @param {PointerEvent} e
   * @returns {boolean} true if handled
   */
  function tryScaleBarPointerUp(e) {
    if (!scaleBarDragging || e.pointerId !== scaleBarPointerId) return false;
    scaleBarDragging = false;
    scaleBarPointerId = null;
    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    if (typeof onRedraw === 'function') onRedraw();
    return true;
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  function hitTest(clientX, clientY) {
    const p1 = normalizedToClientPixels(line.nx1, line.ny1, container, video);
    const p2 = normalizedToClientPixels(line.nx2, line.ny2, container, video);
    const d1 = Math.hypot(clientX - p1.x, clientY - p1.y);
    const d2 = Math.hypot(clientX - p2.x, clientY - p2.y);
    if (d1 <= HANDLE_RADIUS) return 'a';
    if (d2 <= HANDLE_RADIUS) return 'b';
    return null;
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e) {
    if (phase !== 'adjusting') return;
    const t = hitTest(e.clientX, e.clientY);
    if (!t) return;
    dragTarget = t;
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    if (phase !== 'adjusting' || !dragTarget) return;
    const { nx, ny } = clientToNormalized(e.clientX, e.clientY, container, video);
    if (dragTarget === 'a') {
      line.nx1 = nx;
      line.ny1 = ny;
    } else {
      line.nx2 = nx;
      line.ny2 = ny;
    }
    e.preventDefault();
    if (typeof onRedraw === 'function') onRedraw();
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerUp(e) {
    if (dragTarget) {
      dragTarget = null;
      try {
        e.target.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  function hideScaleBarLabel() {
    if (!scaleBarLabel) return;
    scaleBarLabel.classList.add('hidden');
    scaleBarLabel.setAttribute('aria-hidden', 'true');
  }

  /**
   * Position the DOM ~1 mm label; bar line is drawn on canvas.
   * @param {ReturnType<typeof getVideoContentRect>} vr
   * @param {number} pxPerMmVal
   * @param {number} x0
   * @param {number} y
   */
  function updateScaleBarLabel(vr, pxPerMmVal, x0, y) {
    if (!scaleBarLabel || phase !== 'calibrated' || !source) {
      hideScaleBarLabel();
      return;
    }
    const modeEl = scaleBarLabel.querySelector('.scale-bar-mode');
    if (modeEl) modeEl.textContent = source;
    scaleBarLabel.style.left = `${x0}px`;
    scaleBarLabel.style.top = `${y - 8}px`;
    scaleBarLabel.classList.remove('hidden');
    scaleBarLabel.setAttribute('aria-hidden', 'false');
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   */
  function draw(ctx) {
    const vr = getVideoContentRect(container, video);
    if (phase === 'adjusting') {
      hideScaleBarLabel();
      const p1 = normalizedToClientPixels(line.nx1, line.ny1, container, video);
      const p2 = normalizedToClientPixels(line.nx2, line.ny2, container, video);
      ctx.save();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.fillStyle = '#ffcc00';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      for (const p of [p1, p2]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, HANDLE_RADIUS - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      const label = `Align to ${knownMm} mm`;
      ctx.font = '13px system-ui, sans-serif';
      const pad = 4;
      const tw = ctx.measureText(label).width;
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(mx - tw / 2 - pad, my - 20, tw + pad * 2, 18);
      ctx.fillStyle = '#fff3bf';
      ctx.textAlign = 'center';
      ctx.fillText(label, mx, my - 7);

      ctx.restore();
      return;
    }

    if (phase === 'calibrated' && pxPerMm != null) {
      drawDualReferenceLine(ctx, vr, pxPerMm);
    } else {
      hideScaleBarLabel();
    }
  }

  /**
   * ~1 mm dual reference (white bar with black outline) on video content.
   * Label text is a DOM element so the mode can be styled with CSS.
   * @param {CanvasRenderingContext2D} ctx
   * @param {ReturnType<typeof getVideoContentRect>} vr
   * @param {number} pxPerMmVal
   */
  function drawDualReferenceLine(ctx, vr, pxPerMmVal) {
    const len = mmToOverlayPixels(pxPerMmVal, 1, vr);
    if (len < 4) {
      hideScaleBarLabel();
      return;
    }
    const margin = 16;
    let nxLeft = scaleBarAnchor?.nx;
    let nyBase = scaleBarAnchor?.ny;
    if (nxLeft == null || nyBase == null) {
      nxLeft = margin / Math.max(vr.width, 1);
      nyBase = (vr.height - margin) / Math.max(vr.height, 1);
    }
    const nxMax = Math.max(0, 1 - len / Math.max(vr.width, 1e-6));
    nxLeft = clamp(nxLeft, 0, nxMax);
    nyBase = clamp(nyBase, 0, 1);
    const y = vr.top + nyBase * vr.height;
    const x0 = vr.left + nxLeft * vr.width;
    const x1 = x0 + len;
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.restore();
    updateScaleBarLabel(vr, pxPerMmVal, x0, y);
  }

  return {
    startAdjusting,
    cancel,
    finish,
    applyAuto,
    clearCalibration,
    getPxPerMm,
    getPhase,
    getSource,
    getKnownMm,
    getScaleBarAnchor,
    ensureScaleBarInsideBox,
    isScaleBarDragging,
    hitTestScaleBar,
    tryScaleBarPointerDown,
    tryScaleBarPointerMove,
    tryScaleBarPointerUp,
    getLine: () => ({ ...line }),
    onPointerDown,
    onPointerMove,
    onPointerUp,
    draw,
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
