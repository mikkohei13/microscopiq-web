/**
 * Persisted UI preferences (localStorage).
 */

const STORAGE_KEY = 'microscopiq.settings.v1';

/**
 * @typedef {'single' | 'burst' | 'focusStack'} CaptureMode
 * @typedef {{ captureMode: CaptureMode, burstCount: number, burstIntervalSec: number }} BurstSettings
 */

function clampCount(n) {
  const x = Math.round(Number(n));
  if (Number.isNaN(x)) return 5;
  return Math.min(30, Math.max(1, x));
}

function clampIntervalSec(sec) {
  const x = Number(sec);
  if (Number.isNaN(x)) return 1;
  return Math.min(3, Math.max(1, Math.round(x * 10) / 10));
}

/** @returns {BurstSettings} */
export function defaultBurstSettings() {
  return { captureMode: 'single', burstCount: 5, burstIntervalSec: 1 };
}

/** @returns {BurstSettings} */
export function readBurstSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBurstSettings();
    const o = JSON.parse(raw);
    /** @type {CaptureMode} */
    let captureMode = 'single';
    if (o.captureMode === 'burst' || o.captureMode === 'focusStack') {
      captureMode = o.captureMode;
    } else if (o.burstMode === true) {
      captureMode = 'burst';
    }
    return {
      captureMode,
      burstCount: clampCount(o.burstCount),
      burstIntervalSec: clampIntervalSec(o.burstIntervalSec),
    };
  } catch {
    return defaultBurstSettings();
  }
}

/** @param {BurstSettings} s */
export function writeBurstSettings(s) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 2,
        captureMode: s.captureMode,
        burstCount: clampCount(s.burstCount),
        burstIntervalSec: clampIntervalSec(s.burstIntervalSec),
      })
    );
  } catch {
    /* ignore quota / private mode */
  }
}
