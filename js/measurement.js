/**
 * On-screen measurement lines (green) with mm labels when calibrated.
 */

import {
  clientToNormalized,
  normDistanceToSourcePixels,
  normalizedToClientPixels,
} from './overlay.js';
import { computeMeasurementLabelPlacements } from './measurement-label-layout.js';

/**
 * @typedef {{ nx1: number, ny1: number, nx2: number, ny2: number }} NormSegment
 */

export function createMeasurementController(options) {
  const { container, video, getPxPerMm, isCalibrated, onRedraw } = options;

  /** @type {NormSegment[]} */
  let lines = [];
  let active = false;
  let relativeMode = false;
  let refIndex = -1;
  /** @type {NormSegment | null} */
  let draft = null;
  let selectedIndex = -1;
  /** @type {{ type: 'endpoint', lineIndex: number, endpoint: 1 | 2 } | null} */
  let editDrag = null;

  function triggerRedraw() {
    if (typeof onRedraw === 'function') onRedraw();
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function pxDist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function pointToSegmentDistancePx(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 <= 1e-6) return Math.hypot(apx, apy);
    const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / ab2));
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    return Math.hypot(p.x - qx, p.y - qy);
  }

  function setRef(index) {
    if (index >= 0 && index < lines.length) {
      refIndex = index;
    }
  }

  function getRefIndex() {
    if (refIndex >= 0 && refIndex < lines.length) return refIndex;
    return -1;
  }

  function segmentPx(seg) {
    return normDistanceToSourcePixels(seg.nx1, seg.ny1, seg.nx2, seg.ny2, video);
  }

  function segmentRatio(seg, refSeg) {
    const refPx = segmentPx(refSeg);
    if (refPx <= 1e-9) return 0;
    return segmentPx(seg) / refPx;
  }

  function segmentLabel(seg, lineIndex, refIdx, refSeg) {
    if (lineIndex === refIdx) return '1';
    return segmentRatio(seg, refSeg).toFixed(2);
  }

  function findNearestHit(nx, ny) {
    if (lines.length === 0) return null;
    const p = normalizedToClientPixels(nx, ny, container, video);
    const endpointHitRadiusPx = 14;
    const lineHitRadiusPx = 10;
    let bestEndpoint = null;
    let bestEndpointDist = Infinity;
    let bestLine = null;
    let bestLineDist = Infinity;

    for (let i = 0; i < lines.length; i += 1) {
      const seg = lines[i];
      const p1 = normalizedToClientPixels(seg.nx1, seg.ny1, container, video);
      const p2 = normalizedToClientPixels(seg.nx2, seg.ny2, container, video);
      const d1 = pxDist(p, p1);
      const d2 = pxDist(p, p2);
      if (d1 < bestEndpointDist) {
        bestEndpointDist = d1;
        bestEndpoint = { type: 'endpoint', lineIndex: i, endpoint: 1 };
      }
      if (d2 < bestEndpointDist) {
        bestEndpointDist = d2;
        bestEndpoint = { type: 'endpoint', lineIndex: i, endpoint: 2 };
      }
      const dLine = pointToSegmentDistancePx(p, p1, p2);
      if (dLine < bestLineDist) {
        bestLineDist = dLine;
        bestLine = { type: 'line', lineIndex: i };
      }
    }

    if (bestEndpoint && bestEndpointDist <= endpointHitRadiusPx) {
      return bestEndpoint;
    }
    if (bestLine && bestLineDist <= lineHitRadiusPx) {
      return bestLine;
    }
    return null;
  }

  function setActive(on) {
    active = on;
    if (!on) {
      draft = null;
      editDrag = null;
      selectedIndex = -1;
    }
  }

  function isActive() {
    return active;
  }

  function clear() {
    lines = [];
    draft = null;
    editDrag = null;
    selectedIndex = -1;
    refIndex = -1;
    triggerRedraw();
  }

  function deleteSelected() {
    if (selectedIndex < 0 || selectedIndex >= lines.length) return false;
    const removed = selectedIndex;
    lines.splice(removed, 1);
    if (refIndex === removed) {
      refIndex = lines.length > 0 ? 0 : -1;
    } else if (refIndex > removed) {
      refIndex -= 1;
    }
    selectedIndex = -1;
    editDrag = null;
    triggerRedraw();
    return true;
  }

  function setRelativeMode(on) {
    relativeMode = on;
    if (on && refIndex < 0 && lines.length > 0) {
      refIndex = 0;
    }
    triggerRedraw();
  }

  function isRelativeMode() {
    return relativeMode;
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e) {
    if (!active) return;
    const { nx, ny, inside } = clientToNormalized(
      e.clientX,
      e.clientY,
      container,
      video
    );
    if (!inside) return;
    const hit = findNearestHit(nx, ny);
    if (hit && hit.type === 'endpoint') {
      selectedIndex = hit.lineIndex;
      setRef(hit.lineIndex);
      editDrag = hit;
      draft = null;
    } else if (hit && hit.type === 'line') {
      selectedIndex = hit.lineIndex;
      setRef(hit.lineIndex);
      editDrag = null;
      draft = null;
    } else {
      selectedIndex = -1;
      editDrag = null;
      draft = { nx1: nx, ny1: ny, nx2: nx, ny2: ny };
    }
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    triggerRedraw();
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    if (!active) return;
    const { nx, ny } = clientToNormalized(
      e.clientX,
      e.clientY,
      container,
      video
    );
    if (draft) {
      draft.nx2 = clamp01(nx);
      draft.ny2 = clamp01(ny);
    } else if (editDrag) {
      const seg = lines[editDrag.lineIndex];
      if (!seg) return;
      if (editDrag.endpoint === 1) {
        seg.nx1 = clamp01(nx);
        seg.ny1 = clamp01(ny);
      } else {
        seg.nx2 = clamp01(nx);
        seg.ny2 = clamp01(ny);
      }
    } else {
      return;
    }
    e.preventDefault();
    triggerRedraw();
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerUp(e) {
    if (!active) return;
    if (draft) {
      const d = normDistanceToSourcePixels(
        draft.nx1,
        draft.ny1,
        draft.nx2,
        draft.ny2,
        video
      );
      if (d > 2) {
        lines.push({ ...draft });
        selectedIndex = lines.length - 1;
        setRef(selectedIndex);
      }
    }
    draft = null;
    editDrag = null;
    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    triggerRedraw();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   */
  function draw(ctx) {
    if (typeof isCalibrated === 'function' && !isCalibrated()) {
      return;
    }
    if (!active && lines.length === 0) return;

    const pxPerMm = typeof getPxPerMm === 'function' ? getPxPerMm() : null;
    const refIdx = getRefIndex();
    const refSeg = refIdx >= 0 ? lines[refIdx] : null;
    const showRelativeLabels =
      relativeMode && refSeg != null && segmentPx(refSeg) > 1e-9;
    const showAbsoluteLabels = !relativeMode && pxPerMm != null && pxPerMm > 0;

    const drawSegmentStroke = (seg, isDraft, isSelected, isRelativeRef) => {
      const p1 = normalizedToClientPixels(seg.nx1, seg.ny1, container, video);
      const p2 = normalizedToClientPixels(seg.nx2, seg.ny2, container, video);
      ctx.save();
      ctx.strokeStyle = isDraft
        ? 'rgba(80, 220, 120, 0.7)'
        : isRelativeRef
          ? '#f97316'
          : isSelected
            ? '#86efac'
            : '#4ade80';
      ctx.lineWidth = isSelected || isRelativeRef ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      if (isSelected && !isDraft) {
        ctx.fillStyle = isRelativeRef ? '#ffedd5' : '#bbf7d0';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.5;
        for (const p of [p1, p2]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    for (let i = 0; i < lines.length; i += 1) {
      drawSegmentStroke(
        lines[i],
        false,
        i === selectedIndex,
        showRelativeLabels && i === refIdx
      );
    }
    if (draft) {
      drawSegmentStroke(draft, true, false, false);
    }

    if (showRelativeLabels || showAbsoluteLabels) {
      const font = '13px system-ui, sans-serif';
      const pad = 4;
      const boxH = 18;
      ctx.font = font;
      /** @type {{ midX: number, midY: number, vx: number, vy: number, tw: number, pad: number, boxH: number }[]} */
      const labelItems = [];
      /** @type {string[]} */
      const labelTexts = [];
      /** @type {boolean[]} */
      const labelIsRef = [];

      const pushAbsoluteLabel = (seg) => {
        const p1 = normalizedToClientPixels(seg.nx1, seg.ny1, container, video);
        const p2 = normalizedToClientPixels(seg.nx2, seg.ny2, container, video);
        const srcPx = normDistanceToSourcePixels(
          seg.nx1,
          seg.ny1,
          seg.nx2,
          seg.ny2,
          video
        );
        const mm = srcPx / pxPerMm;
        const text = `${mm.toFixed(2)} mm`;
        const tw = ctx.measureText(text).width;
        labelTexts.push(text);
        labelIsRef.push(false);
        labelItems.push({
          midX: (p1.x + p2.x) / 2,
          midY: (p1.y + p2.y) / 2,
          vx: p2.x - p1.x,
          vy: p2.y - p1.y,
          tw,
          pad,
          boxH,
        });
      };

      const pushRelativeLabel = (seg, lineIndex) => {
        const p1 = normalizedToClientPixels(seg.nx1, seg.ny1, container, video);
        const p2 = normalizedToClientPixels(seg.nx2, seg.ny2, container, video);
        const text = segmentLabel(seg, lineIndex, refIdx, refSeg);
        const isRefLabel = lineIndex >= 0 && lineIndex === refIdx;
        const tw = ctx.measureText(text).width;
        labelTexts.push(text);
        labelIsRef.push(isRefLabel);
        labelItems.push({
          midX: (p1.x + p2.x) / 2,
          midY: (p1.y + p2.y) / 2,
          vx: p2.x - p1.x,
          vy: p2.y - p1.y,
          tw,
          pad,
          boxH,
        });
      };

      if (showRelativeLabels) {
        for (let i = 0; i < lines.length; i += 1) {
          pushRelativeLabel(lines[i], i);
        }
        if (draft) {
          pushRelativeLabel(draft, -1);
        }
      } else {
        for (let i = 0; i < lines.length; i += 1) {
          pushAbsoluteLabel(lines[i]);
        }
        if (draft) {
          pushAbsoluteLabel(draft);
        }
      }

      if (labelItems.length > 0) {
        const placements = computeMeasurementLabelPlacements(labelItems);
        ctx.save();
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < placements.length; i += 1) {
          const pl = placements[i];
          const text = labelTexts[i];
          const isRefLabel = labelIsRef[i];
          ctx.fillStyle = isRefLabel
            ? 'rgba(124, 45, 18, 0.88)'
            : 'rgba(0,0,0,0.65)';
          ctx.fillRect(
            pl.cx - pl.boxW / 2,
            pl.cy - boxH / 2,
            pl.boxW,
            boxH
          );
          ctx.fillStyle = isRefLabel ? '#ffedd5' : '#b6f7c4';
          ctx.fillText(text, pl.cx, pl.cy);
        }
        ctx.restore();
      }
    }
  }

  return {
    setActive,
    isActive,
    clear,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    draw,
    hasLines: () => lines.length > 0,
    hasSelection: () => selectedIndex >= 0 && selectedIndex < lines.length,
    deleteSelected,
    setRelativeMode,
    isRelativeMode,
    getRefIndex,
    getLines: () => lines.map((seg) => ({ ...seg })),
  };
}
