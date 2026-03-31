# Optimization Task: Lazy Thumbnail Loading via IntersectionObserver

## Description of the Bottleneck

`FaceList.jsx` currently triggers thumbnail loads for all faces as soon as `faces` prop is set
(via the `useEffect` introduced in optimization task #04). While batching reduces HTTP requests
from N to 1 per load, ALL thumbnails are still fetched regardless of whether the face card is
actually visible in the scrollable sidebar.

The sidebar has `max-h-[480px]` with `overflow-y-auto`. If 50 faces are registered, only ~8-10
cards are visible without scrolling. The other 40-42 cards' thumbnails are fetched immediately
but may never be viewed.

**Affected code:** `frontend/src/components/FaceList.jsx`

## Current Performance Metric (Baseline)

With 50 faces, initial page load thumbnail fetch:
- **Current (batch):** 1 HTTP request, ~8ms, all 50 thumbnails (~500KB total payload)
- **With IntersectionObserver:** 1 HTTP request per scroll viewport of ~10 faces, ~3ms, ~100KB
  initial payload, remaining fetched on-demand

**Network savings:** ~80% reduction in initial thumbnail payload at 50 faces.
**Time-to-visible-content:** ~5× faster (100KB vs 500KB initial load).

## Proposed Optimization Strategy

Replace the batched `useEffect` with an `IntersectionObserver` that tracks which face cards
enter the viewport and batches their IDs into a debounced fetch call.

```jsx
// FaceList.jsx — replace thumbnail useEffect with:
import { useEffect, useRef, useCallback } from "react";

// Track refs to each face card div
const cardRefs = useRef({});
const pendingFetch = useRef(null);

// Debounced batch fetch: waits 50ms to collect multiple entries before firing
const fetchVisible = useCallback((ids) => {
    clearTimeout(pendingFetch.current);
    pendingFetch.current = setTimeout(async () => {
        const missing = ids.filter(id => !thumbnails[id]);
        if (missing.length === 0) return;
        try {
            const res = await api.get(`/api/faces/thumbnails?ids=${missing.join(",")}`);
            setThumbnails(prev => ({ ...prev, ...res.data }));
        } catch (e) {
            console.error("Thumbnail batch fetch failed:", e);
        }
    }, 50);
}, [thumbnails]);

useEffect(() => {
    const observer = new IntersectionObserver(
        (entries) => {
            const visibleIds = entries
                .filter(e => e.isIntersecting)
                .map(e => e.target.dataset.faceId);
            if (visibleIds.length > 0) fetchVisible(visibleIds);
        },
        { threshold: 0.1 }
    );

    Object.entries(cardRefs.current).forEach(([id, el]) => {
        if (el) observer.observe(el);
    });

    return () => observer.disconnect();
}, [faces, fetchVisible]);

// In the face card JSX:
<div
    key={face.id}
    ref={el => cardRefs.current[face.id] = el}
    data-face-id={face.id}
    className="..."
>
```

## Steps to Implement & Verify

1. Implement after task #04 (batch thumbnails endpoint must exist first).
2. Add `cardRefs`, `pendingFetch`, and `fetchVisible` as shown above.
3. Replace the `useEffect` batch call with the `IntersectionObserver` setup.
4. Add `data-face-id={face.id}` and `ref` callback to each face card div.
5. Verify: register 30 faces, reload. Open DevTools Network tab. Confirm only ~10 thumbnail
   requests fire on load. Scroll down — confirm remaining batch fires on scroll.
6. Measure: `performance.now()` before and after initial face list render. Should be
   noticeably faster with 50+ faces.
