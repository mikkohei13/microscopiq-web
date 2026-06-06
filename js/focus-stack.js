/**
 * Run focus-stack fusion in a dedicated worker (OpenCV.js loads inside the worker).
 */

const workerUrl = new URL('./focus-stack-worker.js', import.meta.url);

/**
 * @param {Blob[]} blobs PNG frames (3–15).
 * @param {(phase: string) => void} [onProgress]
 * @returns {Promise<Blob>} Stacked PNG.
 */
export function runFocusStackInWorker(blobs, onProgress) {
  if (blobs.length < 3 || blobs.length > 15) {
    return Promise.reject(new Error('Focus stack needs between 3 and 15 frames.'));
  }

  return Promise.all(blobs.map((b) => b.arrayBuffer())).then((buffers) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl);
      const transferred = buffers.slice();

      worker.onmessage = (ev) => {
        const m = ev.data;
        if (!m || typeof m !== 'object') return;
        if (m.type === 'opencvReady') return;
        if (m.type === 'progress' && typeof m.phase === 'string') {
          onProgress?.(m.phase);
          return;
        }
        if (m.type === 'result' && m.buffer instanceof ArrayBuffer) {
          worker.terminate();
          resolve(new Blob([m.buffer], { type: 'image/png' }));
          return;
        }
        if (m.type === 'error') {
          worker.terminate();
          reject(new Error(typeof m.message === 'string' ? m.message : 'Focus stack failed'));
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        reject(
          new Error(e.message || 'Focus stack worker failed to load or crashed.')
        );
      };

      try {
        worker.postMessage({ type: 'process', buffers: transferred }, transferred);
      } catch (e) {
        worker.terminate();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    })
  );
}
