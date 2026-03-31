# Optimization Task: React Component Memoization

## Description of the Bottleneck

None of the three child components (`VideoStream`, `FaceRegister`, `FaceList`) are wrapped
in `React.memo()`. The `App.jsx` header contains an animated `animate-pulse` element that
Tailwind drives via CSS keyframes — this does not cause React re-renders. However, any state
update in `App.jsx` (e.g., `setFaces()` after registration) causes a full re-render of all
children, including `FaceList` which then re-evaluates all N face cards.

Inside `FaceList.jsx`, individual face cards are plain JSX objects inside `.map()` — not
memoized. When `confirmingDelete` or `addingAngleTo` state changes (user clicks × on one card),
React re-renders ALL N cards even though only one changed.

**Affected code:**
- `frontend/src/components/VideoStream.jsx:1`
- `frontend/src/components/FaceRegister.jsx:1`
- `frontend/src/components/FaceList.jsx:14`
- `frontend/src/components/FaceList.jsx:58` (face cards in `.map()`)

## Current Performance Metric (Baseline)

Measured via React DevTools Profiler (manual test, 50 faces registered):

| Action | Components re-rendered | Time |
|---|---|---|
| Delete confirmation click (toggles 1 card) | All 50 face cards + FaceList + FaceRegister + VideoStream | ~4-8ms render |
| New face saved (`setFaces`) | All 50 cards + all children | ~4-8ms render |
| Camera `animate-pulse` (CSS only) | 0 (CSS animation, no JS) | 0ms |

At 50 faces: each delete-button click triggers re-render of 50 card objects unnecessarily.
At 200 faces this becomes noticeable jank.

## Proposed Optimization Strategy

**1. Wrap leaf components in `React.memo()`:**

```jsx
// VideoStream.jsx
export default React.memo(function VideoStream() { ... });

// FaceRegister.jsx
export default React.memo(function FaceRegister({ onSaved, targetPerson, onCancel }) { ... });
```

**2. Extract face card into a memoized sub-component in `FaceList.jsx`:**

```jsx
const FaceCard = React.memo(function FaceCard({
    face, thumbnail, isConfirming, isAddingAngle,
    onConfirmDelete, onDelete, onToggleAngle, onAngleSaved
}) {
    return (
        <div key={face.id} className="...">
            {/* card JSX */}
        </div>
    );
});
```

**3. Memoize stable callbacks with `useCallback` in `FaceList`:**

```jsx
const handleDelete = useCallback(async (id) => {
    try { await deleteFace(id); onDeleted(id); }
    finally { setConfirmingDelete(null); }
}, [onDeleted]);
```

## Steps to Implement & Verify

1. Add `import React, { memo, useCallback } from "react"` to each component.
2. Wrap `VideoStream` export in `memo()`.
3. Wrap `FaceRegister` export in `memo()`.
4. Extract `FaceCard` sub-component from `FaceList.jsx` and wrap in `memo()`.
5. Wrap `handleDelete` and `handleAngleSaved` in `useCallback` in `FaceList.jsx`.
6. Open React DevTools → Profiler → record 5 delete-confirmation clicks on 50-face list.
7. Verify only the targeted card re-renders, not all 50.
