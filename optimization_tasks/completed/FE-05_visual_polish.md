# Optimization Task: Visual Polish — Skeleton Loaders, Animations, Modal UX

## Description of the Bottleneck

Several micro-UX issues degrade the perceived quality of the application:

1. **No skeleton loaders:** Initial face list load shows empty text for ~100-500ms. The
   transition from "empty" to "populated" causes a jarring Cumulative Layout Shift (CLS).
2. **Modal feels flat:** FaceRegister backdrop is `bg-black/60` with no blur — the modal
   visually "floats" in space without depth. Standard practice is `backdrop-blur-sm`.
3. **Error messages appear instantly:** The `{error && <p>...}` toggle snaps in/out with
   no transition — visually harsh, especially on repeated capture retries.
4. **Action feedback on face card:** Deleting a face card causes it to instantly disappear.
   No exit animation — the list reflows abruptly.
5. **Register button:** The "+ Register New Face" button has no press feedback beyond color
   change. `active:scale-95` would provide tactile feel.
6. **Empty state:** Plain text "No faces registered yet." — should include a subtle icon/
   illustration and a CTA.

## Proposed Optimization Strategy

1. **FaceCardSkeleton component:** 3 skeleton cards with animated pulse, matching exact
   dimensions of real FaceCard (w-10 circle + two text lines). Shown while `isLoading`.
2. **Modal backdrop:** Add `backdrop-blur-sm` to the fixed overlay div.
3. **Error transition:** Wrap error in a container with transition-all for smooth appear/disappear.
4. **Button press feedback:** Add `active:scale-95 transition-transform` to capture/save buttons.
5. **Empty state:** Add a camera icon SVG + descriptive subtext.

## Steps to Implement & Verify

1. Create `FaceCardSkeleton` as inline component in FaceList.jsx.
2. Show 3 skeleton cards when `isLoading` prop is true.
3. Add `backdrop-blur-sm` to FaceRegister modal overlay.
4. Add CSS transition to error message container.
5. Add `active:scale-95` to capture/save buttons in FaceRegister.
6. Redesign empty state with icon + CTA text.
