# microscopiq-web

Microscopiq is a browser-based microscope capture tool: live camera preview, scale calibration, measurements on the preview, and PNG export (plain or with overlays).

**Start camera** appears over the preview when the stream is off. There is no in-app stop; reload the page to reset the camera. **Calibrate** opens a dialog (known distance in mm, then align the yellow line). Measurements work only after calibration. **Clear scale** lives in that same dialog and removes calibration and measurements. *Clear measurements* removes all measurement lines; *Delete selected* removes the current selection. The on-screen ~1 mm scale bar can be dragged; exports use the same position.

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
- Calibration stores `pxPerMm` from a line in that space. A normalized anchor places the ~1 mm bar on overlay and in `composePngWithScaleBar`.
- Export builds a PNG in memory (scale bar and optional measurement lines), then triggers a download.

## Improvement ideas

- When measurement lines overlap, the length indicator labels can also overlap. Make the labels move so that they remain close to the line they are associated with, but they don't overlap.
- Ability to enter HEX code for the measurement line color, persisted in browser storage.
