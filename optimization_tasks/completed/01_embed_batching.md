# Optimization Task: Batched Face Embedding Inference
<!-- STATUS: COMPLETED ✅ -->

## Description of the Bottleneck

`recognition.py::embed()` calls `resnet(face_tensor.unsqueeze(0))` with a batch size of 1 for
every detected face independently. When a frame contains N faces, the pipeline calls `embed()`
N times sequentially, waiting 23ms per call. The GPU/CPU has capacity to process multiple faces
in a single forward pass at almost identical latency to a single face — batching amortizes the
fixed inference overhead (model loading, memory transfer) across all faces.

**Affected code:** `recognition.py:36-48` (embed), `pipeline.py:31-52` (_annotate_frame)

## Current Performance Metric (Baseline)

From `benchmarks/baseline_results.json`:

| Scenario | Latency |
|---|---|
| `embed()` — 1 face, batch_size=1 | **23.64 ms mean** |
| 3 faces sequential (3 × 23.64ms) | **~70.9 ms** |
| 5 faces sequential (5 × 23.64ms) | **~118.2 ms** |

At 5 FPS recognition, the embedding step alone consumes **35-59% of each cycle's budget** when
multiple faces are in frame. This is the single largest controllable CPU cost in the pipeline.

## Proposed Optimization Strategy

Stack all face tensors for a given frame into a single `(N, 3, 160, 160)` batch tensor and run
one `resnet(batch)` forward pass. Return all N embeddings at once.

Replace the per-face `embed()` call in `detect_and_embed()` with a single batched call:

```python
# recognition.py — replace the per-face embed() loop with:

def detect_and_embed(pil_image: Image.Image) -> list[dict]:
    mtcnn, resnet = get_models()
    boxes, probs = mtcnn.detect(pil_image)
    if boxes is None:
        return []

    # Collect all qualifying face crops first
    candidates = []
    for box, prob in zip(boxes, probs):
        if prob < 0.90:
            continue
        face_tensor = extract_face(pil_image, box, image_size=160, margin=0)
        candidates.append((box, prob, face_tensor))

    if not candidates:
        return []

    # Single batched forward pass for all faces in this frame
    batch = torch.stack([c[2] for c in candidates]).float().div(255.0)
    batch = (batch - 0.5) / 0.5
    batch = batch.to(_device)
    with torch.no_grad():
        embeddings = resnet(batch)
        embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
    embeddings_np = embeddings.cpu().numpy().astype(np.float32)

    return [
        {"box": [int(b) for b in box], "prob": float(prob), "embedding": emb}
        for (box, prob, _), emb in zip(candidates, embeddings_np)
    ]
```

## Steps to Implement & Verify

1. Replace `detect_and_embed()` in `backend/recognition.py` with the batched version above.
2. Remove the standalone `embed()` function — it is no longer called from the hot path
   (keep it only if `registration.py` needs it; `capture_single_face` processes 1 face).
3. Add a batch benchmark to `benchmarks/bench_all.py`:

```python
# Bench: 1 face, 3 faces, 5 faces — batched vs sequential
for n_faces in [1, 3, 5]:
    tensors = [torch.randint(0, 255, (3, 160, 160)) for _ in range(n_faces)]
    batch = torch.stack(tensors).float().div(255.0)
    batch = (batch - 0.5) / 0.5

    bench(f"batched embed() {n_faces} faces", lambda: resnet(batch.to(_device)), n=30)
```

4. Run the benchmark. Expected result: batched 3-face inference ≈ 25-30ms (vs 70.9ms sequential).
5. Verify recognition accuracy is unchanged by registering 3 faces and confirming all are
   recognised correctly in the live stream.
