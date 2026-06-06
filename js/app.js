/* Save folder UI removed; PNGs use the browser download flow only. */
import {
  startCamera,
  stopCamera,
  captureStill,
  runBurst,
  describeError,
} from './camera.js';
import { setupOverlayResize, syncCanvasSize } from './overlay.js';
import { createCalibrationController } from './calibration.js';
import { createMeasurementController } from './measurement.js';
import {
  composePngWithScaleBar,
  timestampFilename,
  saveBlobToDirectory,
} from './export.js';
import { readBurstSettings, writeBurstSettings } from './settings.js';

const previewArea = document.getElementById('preview-area');
const video = document.getElementById('preview');
const overlay = document.getElementById('overlay');
const cameraIdleLayer = document.getElementById('camera-idle-layer');
const cameraIdleHeadline = document.getElementById('camera-idle-headline');
const cameraIdleDetail = document.getElementById('camera-idle-detail');
const btnStartCenter = document.getElementById('btn-start-camera-center');
const errorOverlay = document.getElementById('error-overlay');
const captureFlash = document.getElementById('capture-flash');

const CAMERA_START_TIMEOUT_MS = 14000;
const btnCalibrate = document.getElementById('btn-calibrate');
const btnCalibrationDone = document.getElementById('btn-calibration-done');
const btnCalibrationCancel = document.getElementById('btn-calibration-cancel');
const btnClearCalibration = document.getElementById('btn-clear-calibration');
const btnClearMeasurements = document.getElementById('btn-clear-measurements');
const btnDeleteMeasurement = document.getElementById('btn-delete-measurement');
const btnCapture = document.getElementById('btn-capture');
const btnCaptureWithMeasurements = document.getElementById(
  'btn-capture-with-measurements'
);
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

const kbdCapture = document.getElementById('kbd-capture');
const kbdCaptureWithMeasurements = document.getElementById(
  'kbd-capture-with-measurements'
);
const kbdCancelBurst = document.getElementById('kbd-cancel-burst');

/** @type {import('./camera.js').CameraHandle | null} */
let cameraHandle = null;

/** Whether the camera stream is running (controls other than Start are enabled). */
let cameraActive = false;

let cameraStarting = false;
let burstCancelled = false;
let burstInProgress = false;

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

function redraw() {
  const ctx = syncCanvasSize(overlay, previewArea);
  if (!ctx) return;
  ctx.clearRect(0, 0, previewArea.clientWidth, previewArea.clientHeight);
  calibration.draw(ctx);
  measurement.draw(ctx);
}

const calibration = createCalibrationController({
  container: previewArea,
  video,
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
  const canUseControls = cameraActive;

  modeRadios.forEach((r) => {
    r.disabled = !canUseControls;
  });
  if (modeRow) {
    modeRow.classList.toggle('is-disabled', !canUseControls);
    modeRow.setAttribute('aria-disabled', canUseControls ? 'false' : 'true');
  }
  burstCountInput.disabled = !canUseControls;
  burstIntervalInput.disabled = !canUseControls;

  btnCalibrationDone.classList.toggle('hidden', phase !== 'adjusting');
  btnCalibrationCancel.classList.toggle('hidden', phase !== 'adjusting');
  btnCalibrationDone.disabled = !canUseControls || !isAdjusting;
  btnCalibrationCancel.disabled = !canUseControls || !isAdjusting;
  btnCalibrate.disabled = !canUseControls || isAdjusting;

  const isCalibrated = phase === 'calibrated';
  btnClearCalibration.disabled =
    !canUseControls || !isCalibrated || isAdjusting;

  const shouldMeasureBeActive =
    canUseControls && !isAdjusting && isCalibrated;
  measurement.setActive(shouldMeasureBeActive);
  overlay.classList.toggle('calibration-cursor', isAdjusting);
  overlay.classList.toggle('measure-cursor', shouldMeasureBeActive);
  if (calibration.getPhase() !== 'calibrated') {
    overlay.classList.remove('scale-bar-cursor', 'scale-bar-dragging');
  }

  btnClearMeasurements.disabled =
    !canUseControls || !isCalibrated || !measurement.hasLines();
  btnDeleteMeasurement.disabled =
    !canUseControls || !isCalibrated || !measurement.hasSelection();

  const canCapture = canUseControls && !burstInProgress;
  btnCapture.disabled = !canCapture;
  btnCaptureWithMeasurements.disabled = !canCapture;

  normalCaptureButtons.classList.toggle('hidden', burstInProgress);
  btnCancelBurst.classList.toggle('hidden', !burstInProgress);
  btnCancelBurst.disabled = !canUseControls || !burstInProgress;

  kbdCapture.disabled = !canUseControls;
  kbdCaptureWithMeasurements.disabled = !canUseControls;
  kbdCancelBurst.disabled = !canUseControls || !burstInProgress;
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

btnCalibrate.addEventListener('click', () => {
  if (!cameraHandle?.stream) return;
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

btnClearCalibration.addEventListener('click', () => {
  if (btnClearCalibration.disabled) return;
  calibration.clearCalibration();
  measurement.clear();
  hideError();
  calibrationDialog.close();
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
 * @param {Blob} rawBlob
 * @param {boolean} withMeasurements
 */
async function exportCapture(rawBlob, withMeasurements) {
  const px = calibration.getPxPerMm();
  const finalBlob = await composePngWithScaleBar(rawBlob, px, {
    withMeasurements,
    measurements: withMeasurements ? measurement.getLines() : [],
    scaleBarAnchor: calibration.getScaleBarAnchor(),
  });
  const name = timestampFilename();
  await saveBlobToDirectory(null, finalBlob, name);
}

/**
 * @param {boolean} withMeasurements
 */
async function doCapture(withMeasurements = false) {
  if (!cameraHandle?.stream || burstInProgress) return;
  hideError();

  if (burstMode) {
    const { count, intervalMs } = persistBurstFromInputs();
    const measuredLines = withMeasurements ? measurement.getLines() : [];
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
          const px = calibration.getPxPerMm();
          const finalBlob = await composePngWithScaleBar(blob, px, {
            withMeasurements,
            measurements: measuredLines,
            scaleBarAnchor: calibration.getScaleBarAnchor(),
          });
          const base = timestampFilename().replace(/\.png$/i, '');
          const name = `${base}_${String(i + 1).padStart(2, '0')}.png`;
          await saveBlobToDirectory(null, finalBlob, name);
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
    await exportCapture(blob, withMeasurements);
  } catch (e) {
    showError(describeError(e) || 'Capture failed');
  }
}

btnCapture.addEventListener('click', () => {
  void doCapture(false);
});

btnCaptureWithMeasurements.addEventListener('click', () => {
  void doCapture(true);
});

kbdCapture.addEventListener('click', () => {
  void doCapture(false);
});

kbdCaptureWithMeasurements.addEventListener('click', () => {
  void doCapture(true);
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
    if (e.shiftKey) {
      kbdCaptureWithMeasurements.click();
    } else {
      kbdCapture.click();
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
  if (calibration.getPhase() === 'adjusting') {
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
overlay.addEventListener('pointerleave', (e) => {
  if (!calibration.isScaleBarDragging()) {
    overlay.classList.remove('scale-bar-cursor');
  }
});

video.addEventListener('loadeddata', () => redraw());

setCameraActive(false);
redraw();
