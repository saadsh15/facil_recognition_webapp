# Optimization Task: Responsive Layout — Mobile/Tablet Stacking

## Description of the Bottleneck

The main layout is `flex-row` with a hardcoded `w-72` sidebar. At viewports below ~900px:
- The stream shrinks to an unusable width (<500px).
- The sidebar cannot be scrolled independently because `overflow-y-auto` only works when the
  parent height is constrained, which it isn't on mobile.
- The sidebar's `max-h-[480px]` on FaceList is hardcoded and wastes vertical space on tall
  displays.

No responsive breakpoints exist anywhere in the component tree.

## Current State

- < 900px viewport: layout breaks, stream is unusable
- Sidebar: fixed 288px regardless of screen size
- FaceList: fixed 480px max-height (arbitrary, not relative to viewport)

## Proposed Optimization Strategy

1. Change `App.jsx` main to `flex-col lg:flex-row`.
2. On mobile, stream takes full width; sidebar is a horizontal panel below it with its own scroll.
3. On lg+, current side-by-side layout is preserved with `lg:w-80` (320px, more breathing room).
4. FaceList `max-h-[480px]` → `max-h-[calc(100vh-16rem)] lg:flex-1` so it fills available height.
5. Sidebar scrolls independently on all breakpoints with `overflow-y-auto`.

## Steps to Implement & Verify

1. Update App.jsx main flex direction.
2. Change sidebar `w-72` → `w-full lg:w-80`.
3. Change sidebar border `border-l` → `border-t lg:border-t-0 lg:border-l`.
4. Update FaceList max-height class.
5. Test at 375px (iPhone SE), 768px (iPad), 1280px (desktop), 1920px (ultrawide).
