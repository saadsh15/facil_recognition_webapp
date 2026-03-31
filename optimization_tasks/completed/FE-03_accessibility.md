# Optimization Task: Accessibility — Focus Trap, ARIA, Keyboard Navigation

## Description of the Bottleneck

FaceRegister modal is not accessible:
- No `role="dialog"` or `aria-modal="true"` — screen readers do not announce it as a modal.
- No focus trap — Tab key escapes the modal and focuses elements behind the backdrop.
- Cancel button has no visible focus ring (Tailwind's default ring is suppressed).
- Action buttons in FaceList (+ and ×) have `title` attributes but no `aria-label` — `title`
  is not reliably announced by screen readers.
- Status changes in VideoStream (connecting → live → disconnected) have no `aria-live` region,
  so screen reader users never hear the status update.

## Current State

- WCAG 2.1 AA failures: 1.3.1 (Info and Relationships), 2.1.1 (Keyboard), 2.1.2 (No Keyboard Trap), 4.1.2 (Name, Role, Value)
- Tab order in open modal: focuses elements behind the backdrop

## Proposed Optimization Strategy

1. **FaceRegister modal:** Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to h2.
   Implement focus trap with `useEffect` that intercepts Tab/Shift+Tab and Escape key.
2. **FaceList buttons:** Replace `title` with `aria-label` on + and × buttons.
3. **VideoStream:** Add `aria-live="polite"` region for status text.
4. **Focus ring:** Add `focus-visible:ring-2 focus-visible:ring-blue-400` to Cancel button.

## Steps to Implement & Verify

1. Add `useRef(modalRef)` in FaceRegister; attach to the modal container div.
2. `useEffect` on `open`: collect all focusable elements inside modal, trap Tab cycle, close on Escape.
3. Auto-focus the first focusable element on open (`focusableEls[0].focus()`).
4. Add ARIA attributes to modal div.
5. Add `aria-label` to FaceList action buttons.
6. Add `aria-live="polite"` + `aria-atomic="true"` status span in VideoStream.
7. Verify with keyboard-only navigation: Tab stays inside modal, Escape closes it.
