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

const previewArea = document.getElementById('preview-area');
const video = document.getElementById('preview');
const overlay = document.getElementById('overlay');
const errorOverlay = document.getElementById('error-overlay');
const captureFlash = document.getElementById('capture-flash');

const btnStart = document.getElementById('btn-start-camera');
const btnCalibrate = document.getElementById('btn-calibrate');
const btnCalibrationDone = document.getElementById('btn-calibration-done');
const btnCalibrationCancel = document.getElementById('btn-calibration-cancel');
const btnClearMeasurements = document.getElementById('btn-clear-measurements');
const btnDeleteMeasurement = document.getElementById('btn-delete-measurement');
const btnCapture = document.getElementById('btn-capture');
const btnCaptureWithMeasurements = document.getElementById(
  'btn-capture-with-measurements'
);

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
  if (!active) {
    modeRadios.forEach((r) => {
      r.disabled = true;
    });
    if (modeRow) {
      modeRow.classList.add('is-disabled');
      modeRow.setAttribute('aria-disabled', 'true');
    }
    burstCountInput.disabled = true;
    burstIntervalInput.disabled = true;
    btnCalibrate.disabled = true;
    btnCalibrationDone.disabled = true;
    btnCalibrationCancel.disabled = true;
    btnClearMeasurements.disabled = true;
    btnDeleteMeasurement.disabled = true;
    btnCapture.disabled = true;
    btnCaptureWithMeasurements.disabled = true;
    kbdCapture.disabled = true;
    kbdCaptureWithMeasurements.disabled = true;
    kbdCancelBurst.disabled = true;
  } else {
    modeRadios.forEach((r) => {
      r.disabled = false;
    });
    if (modeRow) {
      modeRow.classList.remove('is-disabled');
      modeRow.setAttribute('aria-disabled', 'false');
    }
    burstCountInput.disabled = false;
    burstIntervalInput.disabled = false;
    kbdCapture.disabled = false;
    kbdCaptureWithMeasurements.disabled = false;
    kbdCancelBurst.disabled = !burstInProgress;
    btnCapture.disabled = burstInProgress;
    btnCaptureWithMeasurements.disabled = burstInProgress;
    onCalibrationStateChange();
  }
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
  onRedraw: redraw,
});

function onCalibrationStateChange() {
  const phase = calibration.getPhase();
  btnCalibrationDone.classList.toggle('hidden', phase !== 'adjusting');
  btnCalibrationCancel.classList.toggle('hidden', phase !== 'adjusting');
  btnCalibrationDone.disabled = !cameraActive || phase !== 'adjusting';
  btnCalibrationCancel.disabled = !cameraActive || phase !== 'adjusting';
  btnCalibrate.disabled = !cameraActive || phase === 'adjusting';
  overlay.classList.toggle('calibration-cursor', phase === 'adjusting');
  const shouldMeasureBeActive = cameraActive && phase !== 'adjusting';
  measurement.setActive(shouldMeasureBeActive);
  overlay.classList.toggle('measure-cursor', shouldMeasureBeActive);
  updateMeasurementControls();
  redraw();
}

function updateMeasurementControls() {
  btnClearMeasurements.disabled =
    !cameraActive ||
    (!measurement.hasLines() && !measurement.isActive());
  btnDeleteMeasurement.disabled =
    !cameraActive || !measurement.hasSelection();
}

setupOverlayResize(overlay, previewArea, video, redraw);

btnStart.addEventListener('click', async () => {
  if (cameraStarting) return;
  if (cameraHandle?.stream) {
    stopCamera(cameraHandle);
    cameraHandle = null;
    video.srcObject = null;
    btnStart.textContent = 'Start camera';
    setCameraActive(false);
    hideError();
    return;
  }
  hideError();
  cameraStarting = true;
  btnStart.disabled = true;
  try {
    cameraHandle = await startCamera(video);
    btnStart.textContent = 'Stop camera';
    setCameraActive(true);
    video.addEventListener(
      'loadeddata',
      () => {
        redraw();
      },
      { once: true }
    );
  } catch (e) {
    showError(describeError(e) || 'Could not access camera');
    setCameraActive(false);
  } finally {
    cameraStarting = false;
    btnStart.disabled = false;
  }
});

btnCalibrate.addEventListener('click', () => {
  if (!cameraHandle?.stream) {
    showError('Start the camera first.');
    return;
  }
  hideError();
  calibrationMmInput.value = String(
    Math.min(100, Math.max(1, parseInt(calibrationMmInput.value, 10) || 10))
  );
  calibrationDialog.showModal();
});

calibrationDialogCancel.addEventListener('click', () => {
  calibrationDialog.close();
});

calibrationForm.addEventListener('submit', (e) => {
  e.preventDefault();
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

btnClearMeasurements.addEventListener('click', () => {
  measurement.clear();
  updateMeasurementControls();
});

btnDeleteMeasurement.addEventListener('click', () => {
  const deleted = measurement.deleteSelected();
  if (deleted) {
    updateMeasurementControls();
  }
});

function parseBurstOptions() {
  let count = parseInt(burstCountInput.value, 10);
  let intervalSec = parseFloat(burstIntervalInput.value);
  if (Number.isNaN(count)) count = 5;
  if (Number.isNaN(intervalSec)) intervalSec = 0.2;
  count = Math.min(30, Math.max(1, count));
  intervalSec = Math.min(1, Math.max(0.1, intervalSec));
  burstCountInput.value = String(count);
  burstIntervalInput.value = String(intervalSec);
  return { count, intervalMs: Math.round(intervalSec * 1000) };
}

let burstMode = false;

modeRadios.forEach((r) => {
  r.addEventListener('change', () => {
    burstMode = r.checked && r.value === 'burst';
    burstControls.classList.toggle('hidden', !burstMode);
  });
});

burstControls.classList.toggle('hidden', !burstMode);

/**
 * @param {Blob} rawBlob
 * @param {boolean} withMeasurements
 */
async function exportCapture(rawBlob, withMeasurements) {
  const px = calibration.getPxPerMm();
  const finalBlob = await composePngWithScaleBar(rawBlob, px, {
    withMeasurements,
    measurements: withMeasurements ? measurement.getLines() : [],
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
    const { count, intervalMs } = parseBurstOptions();
    const measuredLines = withMeasurements ? measurement.getLines() : [];
    burstInProgress = true;
    burstCancelled = false;
    btnCapture.disabled = true;
    btnCaptureWithMeasurements.disabled = true;
    kbdCancelBurst.disabled = false;
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
      btnCapture.disabled = !cameraActive;
      btnCaptureWithMeasurements.disabled = !cameraActive;
      kbdCancelBurst.disabled = !cameraActive;
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

kbdCancelBurst.addEventListener('click', () => {
  burstCancelled = true;
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
      burstCancelled = true;
    }
  }
});

overlay.addEventListener('pointerdown', (e) => {
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerDown(e);
  } else if (measurement.isActive()) {
    measurement.onPointerDown(e);
    updateMeasurementControls();
  }
});
overlay.addEventListener('pointermove', (e) => {
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerMove(e);
  } else if (measurement.isActive()) {
    measurement.onPointerMove(e);
    updateMeasurementControls();
  }
});
overlay.addEventListener('pointerup', (e) => {
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerUp(e);
  } else if (measurement.isActive()) {
    measurement.onPointerUp(e);
    updateMeasurementControls();
  }
});
overlay.addEventListener('pointercancel', (e) => {
  if (calibration.getPhase() === 'adjusting') {
    calibration.onPointerUp(e);
  } else if (measurement.isActive()) {
    measurement.onPointerUp(e);
    updateMeasurementControls();
  }
});

video.addEventListener('loadeddata', () => redraw());

setCameraActive(false);
redraw();
