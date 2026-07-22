# microscopiq-web

Microscopiq is a browser-based microscope capture tool: live camera preview, scale calibration, measurements on the preview, and PNG export (plain or with overlays).

**Start camera** appears over the preview when the stream is off. There is no in-app stop; reload the page to reset the camera. **Calibrate: Manually** opens a dialog (known distance in mm, then align the yellow line). **Calibrate: Auto** captures the current preview frame and detects a printed three-circle target; the user approves or cancels the result. **Clear scale** removes calibration and measurements. *Clear measurements* removes all measurement lines; *Delete selected* removes the current selection. The on-screen ~1 mm scale bar can be dragged; exports use the same position. The bar is labeled `manual` or `auto` depending on how calibration was done.

Single or **burst** capture; burst frame count and interval are stored in `localStorage`. **[help.html](help.html)** has a short usage summary.

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
- Pipeline (pure JS, no OpenCV): downsample → grayscale → box blur → Otsu threshold (inverted) → connected-component blobs → filter by size/circularity/aspect → match two large + optional reference by spacing → `pxPerMm = pixelDistance / KNOWN_DISTANCE_MM`.
- On success, the frozen frame is shown with A/B/reference marks; **Approve** applies the scale (`source: 'auto'`), **Cancel** discards it. On failure, a dialog asks the user to try again.
- Entry points: [`js/auto-calibrate.js`](js/auto-calibrate.js) (`autoCalibrate`), with preprocess / candidates / match split across the `js/auto-cal-*.js` modules.

## Improvement ideas

- Draw an area on the view, and submit that to an AI model to get identification for the species.
- Ability to enter HEX code for the measurement line color, persisted in browser storage.
- Allow adjusting units of measurement (mm, μm)
