# Optimization Task: App.jsx — Handler Memoization & Loading State

## Description of the Bottleneck

`handleSaved` and `handleDeleted` in `App.jsx` are plain functions redefined on every render.
They are passed as props to `FaceList` (via `onDeleted`, `onUpdated`) and `FaceRegister`
(via `onSaved`). Both components are wrapped in `React.memo()`, but memo shallowly compares
props — and a new function reference always fails the comparison. Net effect: every App
re-render (e.g., state updates from inside FaceList) re-renders all memoized children anyway.
The `React.memo` work from task 05 is entirely negated.

Additionally, the initial `getFaces()` call has no loading state, so during the ~100ms API
round-trip the sidebar shows "No faces registered yet" — a false empty state that confuses
returning users who have faces registered.

## Current Performance Metric (Baseline)

- React DevTools: FaceList + FaceRegister re-render on every faces state change, including
  individual thumbnail loads that trigger `setThumbnails` inside FaceList (which re-renders
  App, which hands new function refs down).
- UX: "No faces registered yet" appears for ~100–500ms on every page load before faces load.

## Proposed Optimization Strategy

1. Wrap `handleSaved` and `handleDeleted` in `useCallback` with `[]` stable deps.
2. Add `isLoading` state, set false in `.finally()` of initial fetch.
3. Pass `isLoading` to `FaceList` so it can show skeleton cards instead of empty text.

## Steps to Implement & Verify

1. Add `useCallback` import to App.jsx.
2. Wrap both handlers.
3. Add `isLoading` state + `.finally()` in useEffect.
4. Pass `isLoading` prop to FaceList.
5. FaceList: render skeleton cards when `isLoading` is true.
6. Open React DevTools Profiler — confirm FaceList/FaceRegister no longer re-render
   when thumbnail state changes inside FaceList.
