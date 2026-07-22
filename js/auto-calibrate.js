/**
 * Single-shot auto-calibration from a preview frame ImageData.
 */

import { KNOWN_DISTANCE_MM } from './auto-cal-constants.js';
import { preprocess } from './auto-cal-preprocess.js';
import { findCandidates } from './auto-cal-candidates.js';
import { matchPattern } from './auto-cal-match.js';

/**
 * @typedef {Object} AutoCalResult
 * @property {number} pxPerMm
 * @property {import('./auto-cal-match.js').PatternMatch} match
 */

/**
 * @param {ImageData} imageData
 * @returns {AutoCalResult | null}
 */
export function autoCalibrate(imageData) {
  if (!imageData?.width || !imageData?.height) return null;
  const { binary } = preprocess(imageData);
  const candidates = findCandidates(binary, imageData.width);
  const match = matchPattern(candidates, imageData.width, null);
  if (!match || !(match.pixelDistance > 0)) return null;
  return {
    pxPerMm: match.pixelDistance / KNOWN_DISTANCE_MM,
    match,
  };
}

/**
 * Decode an image Blob to ImageData via an offscreen canvas.
 * @param {Blob} blob
 * @returns {Promise<ImageData>}
 */
export function blobToImageData(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Canvas unsupported'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode capture'));
    };
    img.src = url;
  });
}
