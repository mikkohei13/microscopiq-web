/**
 * Camera: getUserMedia, optional ImageCapture, burst with cancellation.
 */

/**
 * @typedef {Object} CameraHandle
 * @property {MediaStream | null} stream
 * @property {ImageCapture | null} imageCapture
 */

/**
 * @param {HTMLVideoElement} video
 * @returns {Promise<CameraHandle>}
 */
export async function startCamera(video) {
  /** @type {MediaTrackConstraints[]} */
  const profiles = [
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: { ideal: 'environment' } },
    true,
  ];

  let lastError = null;
  console.log('[camera] start requested');
  for (const profile of profiles) {
    console.log('[camera] trying constraints:', describeConstraints(profile));
    try {
      const stream = await startCameraWithConstraints(video, profile);
      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings ? track.getSettings() : {};
        console.log('[camera] stream active:', {
          deviceId: settings.deviceId || null,
          width: settings.width || null,
          height: settings.height || null,
          frameRate: settings.frameRate || null,
          facingMode: settings.facingMode || null,
        });
      }
      let imageCapture = null;
      if (track && 'ImageCapture' in window) {
        try {
          imageCapture = new ImageCapture(track);
        } catch {
          imageCapture = null;
        }
      }
      console.log('[camera] startup complete');
      return { stream, imageCapture };
    } catch (err) {
      console.warn('[camera] startup attempt failed:', describeError(err));
      lastError = err;
    }
  }

  const message =
    lastError && typeof lastError === 'object' && 'message' in lastError
      ? String(/** @type {{ message?: string }} */ (lastError).message)
      : 'Could not start camera stream';
  throw new Error(message);
}

/**
 * @param {CameraHandle} handle
 */
export function stopCamera(handle) {
  console.log('[camera] stop requested');
  if (handle.stream) {
    for (const t of handle.stream.getTracks()) {
      t.stop();
    }
    handle.stream = null;
  }
  handle.imageCapture = null;
}

/**
 * @param {CameraHandle} handle
 * @param {HTMLVideoElement} video
 * @returns {Promise<Blob>}
 */
export async function captureStill(handle, video) {
  if (handle.imageCapture) {
    try {
      const blob = await handle.imageCapture.takePhoto();
      if (blob && blob.size > 0) return blob;
    } catch {
      /* fall through */
    }
  }
  return captureStillFromVideoElement(video);
}

/**
 * @param {HTMLVideoElement} video
 * @returns {Promise<Blob>}
 */
export function captureStillFromVideoElement(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    return Promise.reject(new Error('Video not ready'));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas unsupported'));
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode image'));
      },
      'image/png',
      1
    );
  });
}

/**
 * @typedef {Object} BurstOptions
 * @property {number} count
 * @property {number} intervalMs
 * @property {() => boolean} isCancelled
 * @property {(index: number, blob: Blob) => void | Promise<void>} onFrame
 */

/**
 * @param {CameraHandle} handle
 * @param {HTMLVideoElement} video
 * @param {BurstOptions} options
 */
export async function runBurst(handle, video, options) {
  const { count, intervalMs, isCancelled, onFrame } = options;
  for (let i = 0; i < count; i++) {
    if (isCancelled()) break;
    const blob = await captureStill(handle, video);
    if (isCancelled()) break;
    await onFrame(i, blob);
    if (i < count - 1 && !isCancelled()) {
      await sleep(intervalMs);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {HTMLVideoElement} video
 * @param {MediaTrackConstraints | true} videoConstraints
 * @returns {Promise<MediaStream>}
 */
async function startCameraWithConstraints(video, videoConstraints) {
  console.log('[camera] getUserMedia begin');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: videoConstraints,
  });
  console.log('[camera] getUserMedia success');

  try {
    await attachAndWarmupVideo(video, stream);
    return stream;
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    throw err;
  }
}

/**
 * Attach stream and wait until at least one frame is ready.
 * @param {HTMLVideoElement} video
 * @param {MediaStream} stream
 */
async function attachAndWarmupVideo(video, stream) {
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = null;
  video.srcObject = stream;

  const attempts = 3;
  for (let i = 0; i < attempts; i += 1) {
    const attemptNo = i + 1;
    console.log(`[camera] warmup attempt ${attemptNo}/${attempts}`);
    try {
      await video.play();
      console.log('[camera] video.play() resolved');
    } catch {
      // Some devices/browsers throw on first call even after permission grant.
      console.warn('[camera] video.play() rejected');
    }
    if (await waitForVideoReady(video, 1200)) {
      console.log('[camera] first frame ready');
      return;
    }
    console.warn('[camera] no frame yet after warmup attempt');
    await sleep(120);
  }

  throw new Error('Camera started but no video frames arrived');
}

/**
 * @param {HTMLVideoElement} video
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForVideoReady(video, timeoutMs) {
  if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
    console.log('[camera] video already ready', {
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
    });
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const done = (ok) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('resize', onReady);
      if (!ok) {
        console.warn('[camera] waitForVideoReady timeout', {
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState,
          timeoutMs,
        });
      }
      resolve(ok);
    };

    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        done(true);
      }
    };

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('resize', onReady);
    timer = setTimeout(() => done(false), timeoutMs);
  });
}

/**
 * @param {MediaTrackConstraints | true} value
 */
function describeConstraints(value) {
  if (value === true) return 'video: true';
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable constraints]';
  }
}

/**
 * @param {unknown} err
 */
function describeError(err) {
  if (err && typeof err === 'object' && 'name' in err && 'message' in err) {
    const e = /** @type {{ name?: string, message?: string }} */ (err);
    return `${e.name || 'Error'}: ${e.message || ''}`.trim();
  }
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
