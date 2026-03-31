# Optimization Task: JPEG Encode Quality Tuning for MJPEG Stream

## Description of the Bottleneck

`stream.py::generate_mjpeg()` encodes every new annotated frame at JPEG quality 80. While the
version counter prevents re-encoding unchanged frames (a major win already), each new encode
still costs 2.35ms at q=80. The stream runs at 30 FPS, meaning up to 30 encodes/second.

JPEG quality 80 produces noticeably larger frames than quality 60, but for a 640×480 surveillance
stream the visual difference is imperceptible at viewing distance. Quality 60 is a 24% speedup
with no meaningful quality degradation for motion video.

Additionally, the JPEG bytes are currently yielded at a hard-coded `quality=80` with no way to
tune at runtime.

**Affected code:** `stream.py:40-43`, `stream.py:6` (JPEG_QUALITY constant)

## Current Performance Metric (Baseline)

From `benchmarks/baseline_results.json`:

| Quality | Mean encode time | Frame size (approx) |
|---|---|---|
| q=80 (current) | **2.354 ms** | ~25-40 KB |
| q=50 | **1.790 ms** | ~12-18 KB |

At a recognition update rate of 5 FPS (5 new annotated frames/sec), the encode budget is:
- **Current (q=80):** 5 × 2.354ms = **11.77ms/sec** on encode alone
- **Optimised (q=60):** 5 × ~2.0ms = **~10.0ms/sec** — saves ~1.8ms/sec CPU

Additionally, lower quality = smaller payload bytes = faster network transmission to browser,
reducing frame-to-display latency on lower-bandwidth localhost loopback.

## Proposed Optimization Strategy

1. Lower `JPEG_QUALITY` constant in `stream.py` from `80` to `60`.
2. Make quality configurable via environment variable `STREAM_JPEG_QUALITY` so it can be
   tuned per deployment without code changes.

```python
# stream.py
import os
JPEG_QUALITY = int(os.environ.get("STREAM_JPEG_QUALITY", "60"))
```

3. Add `STREAM_JPEG_QUALITY=60` to `backend/.env`.

## Steps to Implement & Verify

1. Edit `stream.py` line 6: change `JPEG_QUALITY = 80` to read from env with default 60.
2. Add `STREAM_JPEG_QUALITY=60` to `backend/.env`.
3. Run targeted benchmark:

```python
for q in [80, 70, 60, 50]:
    bench(f"imencode quality={q}", lambda: cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, q]), n=100)
```

4. Open `http://localhost:5173` and verify stream quality is acceptable at q=60.
5. If visual artifacts appear in face label text overlays, increase to q=65 and re-test.
