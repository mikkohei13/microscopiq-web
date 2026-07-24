# microscopiq-web

Microscopiq is a browser-based tool for capturing and measuring images from a microscope camera. It has live preview, automatic scale calibration, on-image measurements, and PNG export, all running locally in the browser with no installation required. You can try the app at https://www.biomi.org/microscopiq/

## Overview

Microscopiq shows a live camera feed and lets you calibrate a real-world scale on top of it, either automatically by capturing a printed [three-circle calibration target](microscopiq_scale.svg) and letting the app detect it, or manually by entering a known distance and aligning a line. Once calibrated, a scale bar is overlaid on the preview, and you can draw measurement lines to get absolute distances, or take proportional measurements relative to another line, directly on screen.

Captures can be taken one at a time or as a burst, with configurable frame count and interval for bursts. Images can be exported as PNG, either as a plain capture or with the scale bar and measurements. An optional automatic cropping trims the frame before export.

Because everything runs client-side in vanilla JavaScript, Microscopiq works without installing any software beyond a browser. See **[help.html](help.html)** for more details.

## Run locally

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

## How it works (technical overview)

- Vanilla JS, no frameworks.
- Camera: `getUserMedia` with constraint fallbacks, warmup on `<video>`, bounded startup timeout; optional `ImageCapture.takePhoto()` with a canvas fallback.
- Preview: `<video>` plus a `<canvas>` overlay; calibration and measurements use coordinates normalized to the fitted video rectangle.
- Manual calibration stores `pxPerMm` from a line in that space. A normalized anchor places the ~1 mm bar on overlay and in `composePngWithScaleBar`.
- Export builds a PNG in memory (scale bar and optional measurement lines), then triggers a download.

### Auto calibration

- Target: three filled black circles on a bright background — two large circles **5 mm** center-to-center, plus a smaller reference circle offset **2.5 mm** from one large circle (used to orient A vs B). Geometry and detection thresholds live in [`js/auto-cal-constants.js`](js/auto-cal-constants.js).
- **Auto** grabs the live preview via canvas (`drawImage` from `<video>`), not hi-res `ImageCapture`, so it works the same in all browsers.
- Pipeline (pure JS, no OpenCV): downsample → grayscale → box blur → Otsu threshold (inverted) → connected-component blobs → filter by circularity/aspect (wide absolute size bounds) → match two large + optional reference by diameter/spacing ratios (scale-invariant; no assumed FOV) → `pxPerMm = pixelDistance / KNOWN_DISTANCE_MM`.
- On success, the frozen frame is shown with A/B/reference marks; **Approve** applies the scale (`source: 'auto'`), **Cancel** discards it. On failure, a dialog asks the user to try again.
- Entry points: [`js/auto-calibrate.js`](js/auto-calibrate.js) (`autoCalibrate`), with preprocess / candidates / match split across the `js/auto-cal-*.js` modules.

## Improvement ideas

- Should have:
    - Color confirm & cancel buttons to make them more distinct.
    - Code review.
- Nice to have:
    - Allow relative measurement mode also when scale is not calibrated.
    - Draw an area on the view, and submit that to an AI model to get identification for the species.
    - Ability to enter HEX code for the measurement line color, persisted in browser storage.
    - Allow adjusting units of measurement (mm, μm)
