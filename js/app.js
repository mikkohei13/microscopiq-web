/* Save folder UI removed; PNGs use the browser download flow only. */
import {
  startCamera,
  stopCamera,
  captureStill,
  captureStillFromVideoElement,
  runBurst,
  describeError,
} from './camera.js';
import {
  setupOverlayResize,
  syncCanvasSize,
  getContainContentRect,
  getVideoContentRect,
} from './overlay.js';
import { createCalibrationController } from './calibration.js';
import { createMeasurementController } from './measurement.js?v=6';
import {
  composePngWithScaleBar,
  cropBlobToNormRect,
  timestampFilename,
  saveBlobToDirectory,
} from './export.js?v=8';
import { readBurstSettings, writeBurstSettings } from './settings.js';
import { autoCalibrate, blobToImageData } from './auto-calibrate.js';
import { createObjectDetectController } from './object-detect.js';

const previewArea = document.getElementById('preview-area');
const video = document.getElementById('preview');
const autoCalStill = /** @type {HTMLImageElement} */ (document.getElementById('auto-cal-still'));
const overlay = document.getElementById('overlay');
const scaleBarLabel = document.getElementById('scale-bar-label');
const cameraIdleLayer = document.getElementById('camera-idle-layer');
const cameraIdleHeadline = document.getElementById('camera-idle-headline');
const cameraIdleDetail = document.getElementById('camera-idle-detail');
const btnStartCenter = document.getElementById('btn-start-camera-center');
const errorOverlay = document.getElementById('error-overlay');
const captureFlash = document.getElementById('capture-flash');

const CAMERA_START_TIMEOUT_MS = 14000;
const btnCalibrateManual = document.getElementById('btn-calibrate-manual');
const btnCalibrateAuto = document.getElementById('btn-calibrate-auto');
const btnCalibrationDone = document.getElementById('btn-calibration-done');
const btnCalibrationCancel = document.getElementById('btn-calibration-cancel');
const btnAutoCalApprove = document.getElementById('btn-auto-cal-approve');
const btnAutoCalCancel = document.getElementById('btn-auto-cal-cancel');
const btnClearCalibration = document.getElementById('btn-clear-calibration');
const btnClearMeasurements = document.getElementById('btn-clear-measurements');
const btnDeleteMeasurement = document.getElementById('btn-delete-measurement');
const btnToggleMeasurementMode = document.getElementById('btn-toggle-measurement-mode');
const btnCaptureHiRes = document.getElementById('btn-capture-hi-res');
const btnCaptureMeasurements = document.getElementById('btn-capture-measurements');
const normalCaptureButtons = document.getElementById('normal-capture-buttons');
const btnCancelBurst = document.getElementById('btn-cancel-burst');

const burstControls = document.getElementById('burst-controls');
const burstCountInput = document.getElementById('burst-count');
const burstIntervalInput = document.getElementById('burst-interval');
const modeRadios = document.querySelectorAll('input[name="capture-mode"]');
const modeRow = document.querySelector('.mode-row');

const calibrationDialog = document.getElementById('calibration-dialog');
const calibrationForm = document.getElementById('calibration-form');
const calibrationMmInput = document.getElementById('calibration-mm');
const calibrationDialogCancel = document.getElementById('calibration-dialog-cancel');
const autoCalFailDialog = /** @type {HTMLDialogElement} */ (
  document.getElementById('auto-cal-fail-dialog')
);

const kbdCaptureHiRes = document.getElementById('kbd-capture-hi-res');
const kbdCaptureMeasurements = document.getElementById('kbd-capture-measurements');
const kbdCancelBurst = document.getElementById('kbd-cancel-burst');
const toggleObjectDetect = /** @type {HTMLInputElement | null} */ (
  document.getElementById('toggle-object-detect')
);

/** @type {import('./camera.js').CameraHandle | null} */
let cameraHandle = null;

/** Whether the camera stream is running (controls other than Start are enabled). */
let cameraActive = false;

let cameraStarting = false;
let burstCancelled = false;
let burstInProgress = false;

/** Auto-cal review: frozen still + pending result (not a calibration phase). */
let autoCalReviewing = false;
/** @type {import('./auto-calibrate.js').AutoCalResult | null} */
let pendingAutoCal = null;
/** @type {string | null} */
let autoCalStillUrl = null;
/** Capture pixel size used for review letterboxing (matches detection coords). */
let autoCalMediaW = 0;
let autoCalMediaH = 0;

/** @type {string | null} */
let lastCameraStartError = null;
/** @type {string | null} */
let lastCameraStartTech = null;

/**
 * @param {unknown} err
 * @returns {{ user: string, tech: string | null }}
 */
function friendlyCameraStartError(err) {
  const tech = describeError(err) || '';
  const lower = tech.toLowerCase();
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String(/** @type {{ message?: string }} */ (err).message)
      : '';
  if (
    lower.includes('notallowederror') ||
    lower.includes('permission denied') ||
    lower.includes('permission')
  ) {
    return {
      user: 'Camera access was denied. Allow the camera for this site in your browser settings, then try again.',
      tech: tech || null,
    };
  }
  if (lower.includes('notfounderror') || lower.includes('devices not found')) {
    return {
      user: 'No camera was found. Check that the USB camera is connected, then reload the page and try again.',
      tech: tech || null,
    };
  }
  if (msg && (msg.includes('too long') || msg.includes('Unplug'))) {
    return { user: msg, tech: tech && tech !== msg ? tech : null };
  }
  return {
    user: 'Camera did not start. Try unplugging the USB camera, plugging it back in, reloading this page, then tap Start camera again.',
    tech: tech || null,
  };
}

/**
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<import('./camera.js').CameraHandle>}
 */
function startCameraWithTimeout(videoEl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          'The camera took too long to respond. Unplug the USB camera, plug it back in, reload this page, then try again.'
        )
      );
    }, CAMERA_START_TIMEOUT_MS);
    startCamera(videoEl)
      .then((handle) => {
        if (settled) {
          stopCamera(handle);
          return;
        }
        settled = true;
        clearTimeout(t);
        resolve(handle);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        reject(err);
      });
  });
}

function updateCameraIdleLayer() {
  if (!cameraIdleLayer || !btnStartCenter || !cameraIdleHeadline || !cameraIdleDetail) {
    return;
  }
  if (cameraActive) {
    cameraIdleLayer.classList.add('hidden');
    return;
  }
  cameraIdleLayer.classList.remove('hidden');
  if (cameraStarting) {
    cameraIdleHeadline.textContent = 'Starting camera…';
    cameraIdleDetail.classList.add('hidden');
    cameraIdleDetail.textContent = '';
    btnStartCenter.textContent = 'Starting…';
    btnStartCenter.disabled = true;
    return;
  }
  btnStartCenter.textContent = 'Start camera';
  btnStartCenter.disabled = false;
  if (lastCameraStartError) {
    cameraIdleHeadline.textContent = lastCameraStartError;
    if (lastCameraStartTech) {
      cameraIdleDetail.textContent = lastCameraStartTech;
      cameraIdleDetail.classList.remove('hidden');
    } else {
      cameraIdleDetail.textContent = '';
      cameraIdleDetail.classList.add('hidden');
    }
  } else {
    cameraIdleHeadline.textContent = 'Start the camera to begin.';
    cameraIdleDetail.textContent = '';
    cameraIdleDetail.classList.add('hidden');
  }
}

function showError(msg) {
  errorOverlay.textContent = msg;
  errorOverlay.classList.remove('hidden');
}

function hideError() {
  errorOverlay.classList.add('hidden');
  errorOverlay.textContent = '';
}

/**
 * When the camera is off, only "Start camera" is enabled.
 * @param {boolean} active
 */
function setCameraActive(active) {
  cameraActive = active;
  if (active) {
    objectDetect.resume();
  } else {
    objectDetect.pause();
  }
  renderUiState();
  updateCameraIdleLayer();
}

function flashCapture() {
  captureFlash.classList.add('visible');
  requestAnimationFrame(() => {
    setTimeout(() => {
      captureFlash.classList.remove('visible');
    }, 80);
  });
}

function exitAutoCalReview() {
  autoCalReviewing = false;
  pendingAutoCal = null;
  autoCalMediaW = 0;
  autoCalMediaH = 0;
  autoCalStill.onload = null;
  if (autoCalStillUrl) {
    URL.revokeObjectURL(autoCalStillUrl);
    autoCalStillUrl = null;
  }
  autoCalStill.removeAttribute('src');
  autoCalStill.classList.add('hidden');
  video.classList.remove('hidden');
  if (cameraActive) objectDetect.resume();
}

/**
 * @param {string} objectUrl
 * @param {import('./auto-calibrate.js').AutoCalResult} result
 * @param {number} mediaW
 * @param {number} mediaH
 */
function enterAutoCalReview(objectUrl, result, mediaW, mediaH) {
  autoCalReviewing = true;
  pendingAutoCal = result;
  autoCalStillUrl = objectUrl;
  autoCalMediaW = mediaW;
  autoCalMediaH = mediaH;
  objectDetect.pause();
  // Keep the <img> hidden: Chrome's object-fit letterboxing for <img> vs <video>
  // can disagree. Freeze frame + marks are both drawn on the overlay canvas.
  autoCalStill.classList.add('hidden');
  video.classList.add('hidden');
  if (scaleBarLabel) {
    scaleBarLabel.classList.add('hidden');
    scaleBarLabel.setAttribute('aria-hidden', 'true');
  }
  const finish = () => {
    renderUiState();
    redraw();
  };
  autoCalStill.onload = () => {
    autoCalStill.onload = null;
    finish();
  };
  autoCalStill.src = objectUrl;
  if (autoCalStill.complete && autoCalStill.naturalWidth > 0) {
    autoCalStill.onload = null;
    finish();
  }
}

/**
 * Draw freeze frame + Large A / Large B / Reference marks for auto-cal review.
 * Frame and marks share the same contain-rect so they stay aligned.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./auto-cal-match.js').PatternMatch} match
 */
function drawAutoCalMatch(ctx, match) {
  const vw = autoCalMediaW;
  const vh = autoCalMediaH;
  const vr = getContainContentRect(previewArea, vw, vh);
  if (!vw || !vh || !vr.width) return;

  if (autoCalStill.naturalWidth > 0) {
    ctx.drawImage(autoCalStill, vr.left, vr.top, vr.width, vr.height);
  }

  const toX = (sx) => vr.left + (sx / vw) * vr.width;
  const toY = (sy) => vr.top + (sy / vh) * vr.height;

  const x1 = toX(match.largeA.cx);
  const y1 = toY(match.largeA.cy);
  const x2 = toX(match.largeB.cx);
  const y2 = toY(match.largeB.cy);

  ctx.save();
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  drawLabeledCenter(ctx, x1, y1, 'Large A', '#ffd166');
  drawLabeledCenter(ctx, x2, y2, 'Large B', '#ffd166');
  if (match.reference) {
    drawLabeledCenter(
      ctx,
      toX(match.reference.cx),
      toY(match.reference.cy),
      'Reference',
      '#4cc9f0'
    );
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {string} label
 * @param {string} color
 */
function drawLabeledCenter(ctx, x, y, label, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = '12px system-ui, sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(label, x + 8, y - 8);
  ctx.fillStyle = color;
  ctx.fillText(label, x + 8, y - 8);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./object-detect.js').NormRect} box
 */
function drawObjectBox(ctx, box) {
  const vr = getVideoContentRect(previewArea, video);
  if (!vr.width || !vr.height) return;
  const x = vr.left + box.nx * vr.width;
  const y = vr.top + box.ny * vr.height;
  const w = box.nw * vr.width;
  const h = box.nh * vr.height;
  ctx.save();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function redraw() {
  const ctx = syncCanvasSize(overlay, previewArea);
  if (!ctx) return;
  ctx.clearRect(0, 0, previewArea.clientWidth, previewArea.clientHeight);
  if (autoCalReviewing && pendingAutoCal) {
    drawAutoCalMatch(ctx, pendingAutoCal.match);
    return;
  }
  const objectBox = objectDetect.getBox();
  if (objectBox) drawObjectBox(ctx, objectBox);
  calibration.draw(ctx);
  measurement.draw(ctx);
}

const objectDetect = createObjectDetectController({
  video,
  intervalMs: 1000,
  onUpdate: (box) => {
    if (box) calibration.ensureScaleBarInsideBox(box);
    redraw();
  },
});

if (toggleObjectDetect) {
  toggleObjectDetect.addEventListener('change', () => {
    objectDetect.setEnabled(toggleObjectDetect.checked);
    if (!cameraActive || autoCalReviewing) {
      objectDetect.pause();
    }
  });
}

const calibration = createCalibrationController({
  container: previewArea,
  video,
  scaleBarLabel,
  onStateChange: onCalibrationStateChange,
  onRedraw: redraw,
});

const measurement = createMeasurementController({
  container: previewArea,
  video,
  getPxPerMm: () => calibration.getPxPerMm(),
  isCalibrated: () => calibration.getPhase() === 'calibrated',
  onRedraw: redraw,
});

function onCalibrationStateChange() {
  renderUiState();
  redraw();
}

function renderUiState() {
  const phase = calibration.getPhase();
  const isAdjusting = phase === 'adjusting';
  const isReviewing = autoCalReviewing;
  const busy = isAdjusting || isReviewing;
  const canUseControls = cameraActive;

  modeRadios.forEach((r) => {
    r.disabled = !canUseControls || busy;
  });
  if (modeRow) {
    modeRow.classList.toggle('is-disabled', !canUseControls || busy);
    modeRow.setAttribute('aria-disabled', canUseControls && !busy ? 'false' : 'true');
  }
  burstCountInput.disabled = !canUseControls || busy;
  burstIntervalInput.disabled = !canUseControls || busy;

  btnCalibrationDone.classList.toggle('hidden', !isAdjusting);
  btnCalibrationCancel.classList.toggle('hidden', !isAdjusting);
  btnCalibrationDone.disabled = !canUseControls || !isAdjusting;
  btnCalibrationCancel.disabled = !canUseControls || !isAdjusting;

  btnAutoCalApprove.classList.toggle('hidden', !isReviewing);
  btnAutoCalCancel.classList.toggle('hidden', !isReviewing);
  btnAutoCalApprove.disabled = !canUseControls || !isReviewing;
  btnAutoCalCancel.disabled = !canUseControls || !isReviewing;

  btnCalibrateManual.disabled = !canUseControls || busy;
  btnCalibrateAuto.disabled = !canUseControls || busy || burstInProgress;

  const isCalibrated = phase === 'calibrated' && !isReviewing;
  btnClearCalibration.disabled = !canUseControls || !isCalibrated || busy;

  const shouldMeasureBeActive =
    canUseControls && !busy && phase === 'calibrated';
  measurement.setActive(shouldMeasureBeActive);
  overlay.classList.toggle('calibration-cursor', isAdjusting);
  overlay.classList.toggle('measure-cursor', shouldMeasureBeActive);
  if (btnToggleMeasurementMode) {
    btnToggleMeasurementMode.disabled = !shouldMeasureBeActive;
    btnToggleMeasurementMode.textContent = measurement.isRelativeMode()
      ? 'Switch to mm'
      : 'Switch to relative';
  }
  if (phase !== 'calibrated' || isReviewing) {
    overlay.classList.remove('scale-bar-cursor', 'scale-bar-dragging');
  }

  btnClearMeasurements.disabled =
    !canUseControls || !isCalibrated || !measurement.hasLines();
  btnDeleteMeasurement.disabled =
    !canUseControls || !isCalibrated || !measurement.hasSelection();

  const canCapture = canUseControls && !burstInProgress && !busy;
  btnCaptureHiRes.disabled = !canCapture;
  btnCaptureMeasurements.classList.toggle('hidden', phase !== 'calibrated' || isReviewing);
  btnCaptureMeasurements.disabled = !canCapture || phase !== 'calibrated';

  normalCaptureButtons.classList.toggle('hidden', burstInProgress);
  btnCancelBurst.classList.toggle('hidden', !burstInProgress);
  btnCancelBurst.disabled = !canUseControls || !burstInProgress;

  kbdCaptureHiRes.disabled = !canUseControls || busy;
  kbdCaptureMeasurements.disabled = !canUseControls || phase !== 'calibrated' || busy;
  kbdCancelBurst.disabled = !canUseControls || !burstInProgress;

  if (toggleObjectDetect) {
    toggleObjectDetect.disabled = !canUseControls || busy;
  }
}

setupOverlayResize(overlay, previewArea, video, redraw);

async function tryStartCamera() {
  if (cameraStarting || cameraActive) return;
  hideError();
  lastCameraStartError = null;
  lastCameraStartTech = null;
  cameraStarting = true;
  updateCameraIdleLayer();
  try {
    cameraHandle = await startCameraWithTimeout(video);
    lastCameraStartError = null;
    lastCameraStartTech = null;
    setCameraActive(true);
    video.addEventListener(
      'loadeddata',
      () => {
        redraw();
      },
      { once: true }
    );
  } catch (e) {
    const { user, tech } = friendlyCameraStartError(e);
    lastCameraStartError = user;
    lastCameraStartTech = tech;
    cameraHandle = null;
    video.srcObject = null;
    setCameraActive(false);
  } finally {
    cameraStarting = false;
    updateCameraIdleLayer();
  }
}

btnStartCenter.addEventListener('click', () => {
  void tryStartCamera();
});

btnCalibrateManual.addEventListener('click', () => {
  if (!cameraHandle?.stream || autoCalReviewing) return;
  hideError();
  calibrationMmInput.value = '';
  calibrationDialog.showModal();
});

calibrationDialogCancel.addEventListener('click', () => {
  calibrationDialog.close();
});

calibrationForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!calibrationForm.checkValidity()) {
    calibrationForm.reportValidity();
    return;
  }
  const mm = parseInt(calibrationMmInput.value, 10);
  calibrationDialog.close();
  calibration.startAdjusting(mm);
  redraw();
});

btnCalibrationDone.addEventListener('click', () => {
  calibration.finish();
  redraw();
});

btnCalibrationCancel.addEventListener('click', () => {
  calibration.cancel();
  redraw();
});

btnCalibrateAuto.addEventListener('click', () => {
  void runAutoCalibration();
});

btnAutoCalApprove.addEventListener('click', () => {
  if (!pendingAutoCal) return;
  const px = pendingAutoCal.pxPerMm;
  exitAutoCalReview();
  calibration.applyAuto(px);
  redraw();
});

btnAutoCalCancel.addEventListener('click', () => {
  exitAutoCalReview();
  renderUiState();
  redraw();
});

async function runAutoCalibration() {
  if (!cameraHandle?.stream || autoCalReviewing || burstInProgress) return;
  if (calibration.getPhase() === 'adjusting') return;
  hideError();

  try {
    flashCapture();
    const blob = await captureStillFromVideoElement(video);
    const imageData = await blobToImageData(blob);
    const result = autoCalibrate(imageData);
    if (!result) {
      autoCalFailDialog.showModal();
      return;
    }
    const url = URL.createObjectURL(blob);
    enterAutoCalReview(url, result, imageData.width, imageData.height);
  } catch (e) {
    showError(describeError(e) || 'Auto calibration failed');
  }
}

btnClearCalibration.addEventListener('click', () => {
  if (btnClearCalibration.disabled) return;
  exitAutoCalReview();
  calibration.clearCalibration();
  measurement.clear();
  hideError();
  redraw();
});

btnClearMeasurements.addEventListener('click', () => {
  measurement.clear();
  renderUiState();
});

btnDeleteMeasurement.addEventListener('click', () => {
  const deleted = measurement.deleteSelected();
  if (deleted) {
    renderUiState();
  }
});

btnToggleMeasurementMode.addEventListener('click', () => {
  if (btnToggleMeasurementMode.disabled) return;
  measurement.setRelativeMode(!measurement.isRelativeMode());
  renderUiState();
  redraw();
});

function parseBurstOptions() {
  let count = parseInt(burstCountInput.value, 10);
  let intervalSec = parseFloat(burstIntervalInput.value);
  if (Number.isNaN(count)) count = 5;
  if (Number.isNaN(intervalSec)) intervalSec = 1;
  count = Math.min(30, Math.max(1, count));
  intervalSec = Math.round(Math.min(3, Math.max(1, intervalSec)) * 10) / 10;
  burstCountInput.value = String(count);
  burstIntervalInput.value = String(intervalSec);
  return { count, intervalMs: Math.round(intervalSec * 1000) };
}

function persistBurstFromInputs() {
  const { count, intervalMs } = parseBurstOptions();
  writeBurstSettings({
    burstMode,
    burstCount: count,
    burstIntervalSec: intervalMs / 1000,
  });
  return { count, intervalMs };
}

let burstMode = false;

function applyBurstSettingsFromStorage() {
  const s = readBurstSettings();
  burstMode = s.burstMode;
  burstCountInput.value = String(s.burstCount);
  burstIntervalInput.value = String(s.burstIntervalSec);
  modeRadios.forEach((r) => {
    r.checked = (r.value === 'burst' && burstMode) || (r.value === 'normal' && !burstMode);
  });
  burstControls.classList.toggle('hidden', !burstMode);
}

applyBurstSettingsFromStorage();
persistBurstFromInputs();

modeRadios.forEach((r) => {
  r.addEventListener('change', () => {
    burstMode = r.checked && r.value === 'burst';
    burstControls.classList.toggle('hidden', !burstMode);
    persistBurstFromInputs();
  });
});

burstCountInput.addEventListener('change', persistBurstFromInputs);
burstIntervalInput.addEventListener('change', persistBurstFromInputs);

/**
 * @param {Blob} blob
 * @returns {string}
 */
function filenameForRawBlob(blob) {
  const base = timestampFilename().replace(/\.png$/i, '');
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
  return `${base}.${ext}`;
}

/**
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
async function maybeCropToObjectBox(blob) {
  const box = objectDetect.getBox();
  if (!box || box.nw <= 0 || box.nh <= 0) return blob;
  return cropBlobToNormRect(blob, box);
}

/**
 * @param {Blob} blob
 */
async function saveRawCapture(blob) {
  const box = objectDetect.getBox();
  if (box && box.nw > 0 && box.nh > 0) {
    const cropped = await cropBlobToNormRect(blob, box);
    await saveBlobToDirectory(null, cropped, timestampFilename());
    return;
  }
  await saveBlobToDirectory(null, blob, filenameForRawBlob(blob));
}

/**
 * @param {Blob} rawBlob
 */
async function exportCaptureWithMeasurements(rawBlob) {
  const px = calibration.getPxPerMm();
  let finalBlob = await composePngWithScaleBar(rawBlob, px, {
    withMeasurements: true,
    measurements: measurement.getLines(),
    measurementRefIndex: measurement.getRefIndex(),
    measurementRelative: measurement.isRelativeMode(),
    scaleBarAnchor: calibration.getScaleBarAnchor(),
    calibrationMode: calibration.getSource(),
  });
  finalBlob = await maybeCropToObjectBox(finalBlob);
  await saveBlobToDirectory(null, finalBlob, timestampFilename());
}

async function doCaptureHiRes() {
  if (!cameraHandle?.stream || burstInProgress || autoCalReviewing) return;
  hideError();

  if (burstMode) {
    const { count, intervalMs } = persistBurstFromInputs();
    burstInProgress = true;
    burstCancelled = false;
    renderUiState();
    try {
      await runBurst(cameraHandle, video, {
        count,
        intervalMs,
        isCancelled: () => burstCancelled,
        onFrame: async (i, blob) => {
          flashCapture();
          const out = await maybeCropToObjectBox(blob);
          const base = timestampFilename().replace(/\.png$/i, '');
          const ext = out.type === 'image/jpeg' ? 'jpg' : 'png';
          const name = `${base}_${String(i + 1).padStart(2, '0')}.${ext}`;
          await saveBlobToDirectory(null, out, name);
        },
      });
    } catch (e) {
      showError(describeError(e) || 'Capture failed');
    } finally {
      burstInProgress = false;
      renderUiState();
    }
    return;
  }

  try {
    flashCapture();
    const blob = await captureStill(cameraHandle, video);
    await saveRawCapture(blob);
  } catch (e) {
    showError(describeError(e) || 'Capture failed');
  }
}

async function doCaptureMeasurements() {
  if (!cameraHandle?.stream || burstInProgress || autoCalReviewing) return;
  if (calibration.getPhase() !== 'calibrated') return;
  hideError();

  try {
    flashCapture();
    const blob = await captureStillFromVideoElement(video);
    await exportCaptureWithMeasurements(blob);
  } catch (e) {
    showError(describeError(e) || 'Capture failed');
  }
}

btnCaptureHiRes.addEventListener('click', () => {
  void doCaptureHiRes();
});

btnCaptureMeasurements.addEventListener('click', () => {
  void doCaptureMeasurements();
});

kbdCaptureHiRes.addEventListener('click', () => {
  void doCaptureHiRes();
});

kbdCaptureMeasurements.addEventListener('click', () => {
  void doCaptureMeasurements();
});

function cancelBurstInFlight() {
  burstCancelled = true;
}

btnCancelBurst.addEventListener('click', () => {
  cancelBurstInFlight();
});

kbdCancelBurst.addEventListener('click', () => {
  cancelBurstInFlight();
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (e.code === 'Enter' || e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey && calibration.getPhase() === 'calibrated' && !autoCalReviewing) {
      kbdCaptureMeasurements.click();
    } else if (!autoCalReviewing) {
      kbdCaptureHiRes.click();
    }
  }
  if (e.code === 'Space' || e.key === ' ') {
    if (burstInProgress) {
      e.preventDefault();
      cancelBurstInFlight();
    }
  }
});

/**
 * Grab/grabbing over the scale bar hit region so it reads as draggable (not crosshair).
 * @param {number} clientX
 * @param {number} clientY
 */
function updateOverlayScaleBarCursor(clientX, clientY) {
  if (autoCalReviewing || calibration.getPhase() === 'adjusting') {
    overlay.classList.remove('scale-bar-cursor', 'scale-bar-dragging');
    return;
  }
  if (calibration.getPhase() !== 'calibrated') {
    overlay.classList.remove('scale-bar-cursor', 'scale-bar-dragging');
    return;
  }
  if (calibration.isScaleBarDragging()) {
    overlay.classList.remove('scale-bar-cursor');
    overlay.classList.add('scale-bar-dragging');
    return;
  }
  overlay.classList.remove('scale-bar-dragging');
  if (calibration.hitTestScaleBar(clientX, clientY)) {
    overlay.classList.add('scale-bar-cursor');
  } else {
    overlay.classList.remove('scale-bar-cursor');
  }
}

overlay.addEventListener('pointerdown', (e) => {
  if (autoCalReviewing) return;
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerDown(e);
  } else if (calibration.tryScaleBarPointerDown(e)) {
    updateOverlayScaleBarCursor(e.clientX, e.clientY);
  } else if (measurement.isActive()) {
    measurement.onPointerDown(e);
    renderUiState();
  }
});
overlay.addEventListener('pointermove', (e) => {
  if (autoCalReviewing) return;
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerMove(e);
  } else if (calibration.isScaleBarDragging()) {
    calibration.tryScaleBarPointerMove(e);
  } else if (measurement.isActive()) {
    measurement.onPointerMove(e);
    renderUiState();
  }
  updateOverlayScaleBarCursor(e.clientX, e.clientY);
});
overlay.addEventListener('pointerup', (e) => {
  if (autoCalReviewing) return;
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerUp(e);
  } else if (calibration.isScaleBarDragging()) {
    calibration.tryScaleBarPointerUp(e);
  } else if (measurement.isActive()) {
    measurement.onPointerUp(e);
    renderUiState();
  }
  updateOverlayScaleBarCursor(e.clientX, e.clientY);
});
overlay.addEventListener('pointercancel', (e) => {
  if (autoCalReviewing) return;
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerUp(e);
  } else if (calibration.isScaleBarDragging()) {
    calibration.tryScaleBarPointerUp(e);
  } else if (measurement.isActive()) {
    measurement.onPointerUp(e);
    renderUiState();
  }
  updateOverlayScaleBarCursor(e.clientX, e.clientY);
});
overlay.addEventListener('pointerleave', () => {
  if (!calibration.isScaleBarDragging()) {
    overlay.classList.remove('scale-bar-cursor');
  }
});

video.addEventListener('loadeddata', () => redraw());

setCameraActive(false);
redraw();
