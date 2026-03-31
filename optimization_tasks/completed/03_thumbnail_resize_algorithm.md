# Optimization Task: Thumbnail Resize Algorithm (LANCZOS → BILINEAR)

## Description of the Bottleneck

`registration.py::capture_single_face()` resizes the cropped face to 120×120 using
`Image.LANCZOS` resampling. LANCZOS is a high-quality sinc-based filter ideal for
print/publishing use cases where quality is paramount. For a 120×120 UI thumbnail that
will be rendered at ≤60px on most screens, LANCZOS quality is completely imperceptible
compared to BILINEAR — but costs 2.3× more CPU time.

**Affected code:** `registration.py:44`

## Current Performance Metric (Baseline)

From `benchmarks/baseline_results.json`:

| Algorithm | Mean resize time | Relative cost |
|---|---|---|
| `Image.LANCZOS` (current) | **0.768 ms** | 1.0× (baseline) |
| `Image.BILINEAR` | **0.333 ms** | **0.43× (57% faster)** |

Absolute saving per capture: **0.435 ms**. This is a small absolute number but a trivial
one-line fix with zero quality impact at this thumbnail size.

## Proposed Optimization Strategy

Replace `Image.LANCZOS` with `Image.BILINEAR` in `registration.py`. For 120×120 thumbnails
displayed at 40-60px CSS size, no human can perceive the difference.

```python
# registration.py:44 — change:
cropped = pil.crop((x1, y1, x2, y2)).resize((120, 120), Image.LANCZOS)
# to:
cropped = pil.crop((x1, y1, x2, y2)).resize((120, 120), Image.BILINEAR)
```

## Steps to Implement & Verify

1. Edit `registration.py` line 44: `Image.LANCZOS` → `Image.BILINEAR`.
2. Register a new face and compare the thumbnail displayed in the sidebar.
3. If quality is acceptable (it will be), the optimisation is complete.
4. Optional: run `benchmarks/bench_all.py` and confirm `resize_bilinear` mean ≈ 0.33ms.
