# Optimization Task: FaceList — Observer Stability & Memo-Breaking Inline Arrow

## Description of the Bottleneck

Two correctness bugs that defeat the optimizations already in place:

**Bug 1 — fetchVisible stability:**
`fetchVisible` is declared with `useCallback([thumbnails])`, meaning it gets a new reference
every time a thumbnail is loaded. The `useEffect([faces, fetchVisible])` that sets up the
`IntersectionObserver` therefore disconnects and reconnects on EVERY thumbnail load. For 10
faces loading their thumbnails, the observer is torn down and rebuilt 10 times. Each rebuild
re-observes all cards, which immediately fire their intersection callbacks again.

**Bug 2 — onToggleAngle inline arrow:**
`onToggleAngle={(id) => setAddingAngleTo(...)}` is an inline arrow inside `faces.map()`.
FaceCard is wrapped in `memo()`, but it receives a new `onToggleAngle` function reference on
every FaceList render. This makes `FaceCard` memo comparison fail for every card every time
any FaceList state changes (thumbnail load, confirmingDelete click, etc.).

## Current Performance Metric (Baseline)

With 20 faces and IntersectionObserver active:
- Observer disconnect+reconnect: ~20 times during initial thumbnail load
- Each reconnect triggers all visible cards to re-fire intersection → 20×N redundant calls
  (blocked by `missing` filter but still executes the debounce timer 20 times)
- FaceCard: all N cards re-render on ANY single card interaction

## Proposed Optimization Strategy

1. Replace `fetchVisible`'s `[thumbnails]` dep with a `useRef` Set (`fetchedIds`) that tracks
   already-fetched IDs. `fetchVisible` becomes stable with `[]` deps.
2. Extract `onToggleAngle` into a `useCallback` handler (`handleToggleAngle`).
3. Clean up stale `cardRefs` entries when a face is deleted (ref the prev faces length).

## Steps to Implement & Verify

1. Add `fetchedIds = useRef(new Set())` to FaceList.
2. Replace `thumbnails[id]` check in `fetchVisible` with `fetchedIds.current.has(id)`.
3. Mark IDs in `fetchedIds` before the async fetch (optimistic, prevents double-fetch).
4. Unmark on error so they can retry.
5. Change `useCallback(fetchVisible, [thumbnails])` → `useCallback(fetchVisible, [])`.
6. Add `handleToggleAngle = useCallback(...)` and pass it to FaceCard.
7. In `useEffect([faces])`, clean up removed face IDs from `cardRefs.current` and `fetchedIds.current`.
