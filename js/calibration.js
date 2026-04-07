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

export function createCalibrationController(options) {
  const {
    container,
    video,
    onStateChange,
    onRedraw,
  } = options;

  /** @type {CalibrationPhase} */
  let phase = 'inactive';
  /** @type {number} */
  let knownMm = 10;
  /** @type {{ nx1: number, ny1: number, nx2: number, ny2: number }} */
  let line = { nx1: 0.35, ny1: 0.5, nx2: 0.65, ny2: 0.5 };
  /** @type {number | null} source pixels per mm */
  let pxPerMm = null;

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
    setPhase('calibrated');
  }

  function clearCalibration() {
    pxPerMm = null;
    setPhase('inactive');
  }

  function getPxPerMm() {
    return pxPerMm;
  }

  function getPhase() {
    return phase;
  }

  function getKnownMm() {
    return knownMm;
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

  /**
   * @param {CanvasRenderingContext2D} ctx
   */
  function draw(ctx) {
    const vr = getVideoContentRect(container, video);
    if (phase === 'adjusting') {
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
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, HANDLE_RADIUS - 2, 0, Math.PI * 2);
      ctx.arc(p2.x, p2.y, HANDLE_RADIUS - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    if (phase === 'calibrated' && pxPerMm != null) {
      drawDualReferenceLine(ctx, vr, pxPerMm);
    }
  }

  /**
   * ~1 mm dual reference (white bar with black outline) at bottom-left of video content.
   * @param {CanvasRenderingContext2D} ctx
   * @param {ReturnType<typeof getVideoContentRect>} vr
   * @param {number} pxPerMmVal
   */
  function drawDualReferenceLine(ctx, vr, pxPerMmVal) {
    const len = mmToOverlayPixels(pxPerMmVal, 1, vr);
    if (len < 4) return;
    const margin = 16;
    const y = vr.top + vr.height - margin;
    const x0 = vr.left + margin;
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
    ctx.fillStyle = '#fff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('~1 mm', x0, y - 8);
    ctx.restore();
  }

  return {
    startAdjusting,
    cancel,
    finish,
    clearCalibration,
    getPxPerMm,
    getPhase,
    getKnownMm,
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
