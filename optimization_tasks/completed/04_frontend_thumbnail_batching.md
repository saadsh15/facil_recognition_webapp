# Optimization Task: Batch Thumbnail Loading (N requests → 1)

## Description of the Bottleneck

`FaceList.jsx` lazy-loads thumbnails by calling `getThumbnail(id)` once per face card — one
individual HTTP GET to `/api/faces/:id/thumbnail` per person. For 50 registered faces, this
fires 50 separate HTTP round-trips on the initial render. Each round-trip has ~1-5ms of
network overhead (localhost) plus 1.96ms server-side DB query time.

The list endpoint (`GET /api/faces`) already returns all person metadata in one call but
deliberately excludes thumbnails to keep the payload small. The current lazy-load fix is
correct in concept but wrong in implementation: it should batch all IDs into a single request.

**Affected code:** `frontend/src/components/FaceList.jsx:59-61`, `frontend/src/api.js:28-30`,
`backend/app.py` (missing batch endpoint)

## Current Performance Metric (Baseline)

Server-side per thumbnail:
- DB query latency: **1.96ms mean** (from benchmark)
- HTTP round-trip overhead (localhost): ~1-3ms

| Faces | Current approach | Batched approach |
|---|---|---|
| 10 faces | 10 requests × ~4ms = **~40ms** | 1 request × ~5ms = **~5ms** |
| 50 faces | 50 requests × ~4ms = **~200ms** | 1 request × ~8ms = **~8ms** |
| 100 faces | 100 requests × ~4ms = **~400ms** | 1 request × ~12ms = **~12ms** |

At 50 faces the sidebar takes ~200ms to fully populate thumbnails vs ~8ms with batching —
a **25× latency reduction** and elimination of 49 HTTP connections.

## Proposed Optimization Strategy

**Backend:** Add `GET /api/faces/thumbnails?ids=uuid1,uuid2,...` endpoint that returns a map
of `{person_id: thumbnail_b64}` in one DB query.

```python
# app.py — add route:
@app.get("/api/faces/thumbnails")
def batch_thumbnails():
    from models import FaceEmbedding
    from sqlalchemy import func
    ids_param = request.args.get("ids", "")
    ids = [i.strip() for i in ids_param.split(",") if i.strip()]
    if not ids or len(ids) > 200:
        return jsonify({"error": "Provide 1-200 ids"}), 400

    SessionLocal = current_app.config["SessionLocal"]
    with SessionLocal() as session:
        # One query: latest thumbnail per person_id
        subq = (
            session.query(
                FaceEmbedding.person_id,
                FaceEmbedding.thumbnail,
                func.row_number().over(
                    partition_by=FaceEmbedding.person_id,
                    order_by=FaceEmbedding.created_at.desc()
                ).label("rn")
            )
            .filter(FaceEmbedding.person_id.in_(ids))
            .subquery()
        )
        rows = session.query(subq).filter(subq.c.rn == 1).all()
    return jsonify({str(row.person_id): row.thumbnail for row in rows if row.thumbnail})
```

**Frontend:** Replace per-card `loadThumbnail()` with a single `useEffect` that batches all
face IDs into one call when `faces` prop changes:

```jsx
// FaceList.jsx — replace the per-render loadThumbnail() call with:
useEffect(() => {
    const missing = faces.filter(f => !thumbnails[f.id]).map(f => f.id);
    if (missing.length === 0) return;
    api.get(`/api/faces/thumbnails?ids=${missing.join(",")}`).then(r => {
        setThumbnails(prev => ({ ...prev, ...r.data }));
    });
}, [faces]);
```

Remove the `loadThumbnail()` call from inside the `faces.map()` render loop entirely.

## Steps to Implement & Verify

1. Add `GET /api/faces/thumbnails` route to `backend/app.py`.
2. Add `batchThumbnails(ids)` to `frontend/src/api.js`.
3. Replace per-card `loadThumbnail()` in `FaceList.jsx` with the `useEffect` batch call.
4. Remove the `if (!thumbnails[face.id]) loadThumbnail(face.id)` line from the render body.
5. Verify: open DevTools Network tab, register 10 faces, reload page. Confirm 1 thumbnail
   request instead of 10.
6. Benchmark: measure time-to-fully-loaded thumbnails with 50 faces before and after.
