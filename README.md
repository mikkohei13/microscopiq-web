# microscopiq-web

Microscopiq is a browser-based microscope capture tool. It streams your device camera, lets you calibrate image scale using a known distance, draw measurement lines on top of the live preview, and save PNG images either as plain captures or with measurement overlays.

## Run locally

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

## How it works (technical overview)

- Camera access uses `getUserMedia` with rear-camera preference and HD constraints.
- The live stream is rendered in a `<video>` element, with a synchronized `<canvas>` overlay for calibration and measurement UI.
- Calibration stores a `pxPerMm` value by mapping a user-adjusted line (in normalized overlay coordinates) to source video pixels.
- Measurements are stored as normalized line segments so they stay aligned across resize/layout changes.
- Capture uses `ImageCapture.takePhoto()` when available, with a canvas fallback from the video frame.
- Export composes a final PNG in memory, optionally drawing a ~1 mm scale bar and measurement lines + labels, then saves via browser download flow.