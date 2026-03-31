import { memo, useState, useEffect, useRef } from "react";
import { captureFrame, saveFace } from "../api";

/**
 * FaceRegister handles two registration modes:
 *   1. New person  — rendered as a full-width "+ Register New Face" button
 *   2. Add angle   — triggered by parent passing targetPerson={id, name}
 *
 * Props:
 *   onSaved(person)         — called with the saved/updated Person after success
 *   targetPerson?           — {id, name} — if set, adds an embedding to this person
 *   onCancel?               — called when the modal is closed in add-angle mode
 *
 * Accessibility:
 *   - role="dialog" + aria-modal + aria-labelledby on modal container
 *   - Focus trapped inside modal while open; first focusable element auto-focused
 *   - Escape key closes the modal
 */
export default memo(function FaceRegister({ onSaved, targetPerson = null, onCancel }) {
  const isAddAngle = Boolean(targetPerson);

  const [open, setOpen] = useState(isAddAngle);
  const [stage, setStage] = useState("idle");
  const [thumbnail, setThumbnail] = useState(null);
  const [captureId, setCaptureId] = useState(null);
  const [name, setName] = useState(targetPerson?.name ?? "");
  const [error, setError] = useState(null);

  const modalRef = useRef(null);
  const headingId = useRef(`facereg-title-${Math.random().toString(36).slice(2)}`).current;

  // Focus trap + Escape handler
  useEffect(() => {
    if (!open) return;

    const modal = modalRef.current;
    if (!modal) return;

    const focusable = modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Auto-focus first element
    first?.focus();

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, stage]); // re-run when stage changes so focusable elements are fresh

  async function handleCapture() {
    setStage("capturing");
    setError(null);
    try {
      const data = await captureFrame();
      setThumbnail(data.thumbnail);
      setCaptureId(data.capture_id);
      setStage("naming");
    } catch (e) {
      const msg =
        e.code === "ECONNABORTED"
          ? "Timed out — server took too long. Try again."
          : e.response?.data?.error ?? "Capture failed. Ensure your face is visible.";
      setError(msg);
      setStage("idle");
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setStage("saving");
    try {
      const person = await saveFace(
        captureId,
        trimmedName,
        isAddAngle ? targetPerson.id : null,
      );
      onSaved(person);
      handleClose();
    } catch (e) {
      setError(e.response?.data?.error ?? "Save failed.");
      setStage("naming");
    }
  }

  function handleClose() {
    setOpen(false);
    setStage("idle");
    setName(targetPerson?.name ?? "");
    setThumbnail(null);
    setCaptureId(null);
    setError(null);
    onCancel?.();
  }

  return (
    <>
      {/* Trigger button — only shown in new-person mode */}
      {!isAddAngle && (
        <button
          onClick={() => setOpen(true)}
          className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold py-2 px-4 rounded-lg transition-all duration-150 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
        >
          + Register New Face
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          aria-hidden="false"
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="bg-white rounded-2xl p-6 w-80 shadow-2xl text-gray-800"
          >
            <h2 id={headingId} className="text-lg font-bold mb-1">
              {isAddAngle ? `Add Angle — ${targetPerson.name}` : "Register New Face"}
            </h2>
            {isAddAngle && (
              <p className="text-xs text-gray-400 mb-4">
                Capture a different angle or lighting condition to improve recognition accuracy.
              </p>
            )}

            {stage === "idle" && (
              <button
                onClick={handleCapture}
                className="w-full bg-green-600 hover:bg-green-700 active:scale-95 text-white py-2 rounded-lg transition-all duration-150 focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:outline-none"
              >
                Capture from Stream
              </button>
            )}

            {stage === "capturing" && (
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Detecting face...</p>
              </div>
            )}

            {(stage === "naming" || stage === "saving") && thumbnail && (
              <div className="flex flex-col items-center gap-3">
                <img
                  src={thumbnail}
                  alt="Captured face"
                  className="w-24 h-24 rounded-full object-cover border-2 border-blue-400"
                />
                {!isAddAngle && (
                  <input
                    type="text"
                    placeholder="Enter name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    autoFocus
                  />
                )}
                <button
                  onClick={handleSave}
                  disabled={stage === "saving" || (!isAddAngle && !name.trim())}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white py-2 rounded-lg transition-all duration-150 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
                >
                  {stage === "saving"
                    ? "Saving..."
                    : isAddAngle
                      ? "Save Angle"
                      : "Save Face"}
                </button>
                <button
                  onClick={handleCapture}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:outline-none rounded px-1"
                >
                  Retake
                </button>
              </div>
            )}

            {/* Error message with smooth transition */}
            <div
              className={`overflow-hidden transition-all duration-200 ${
                error ? "max-h-16 opacity-100 mt-3" : "max-h-0 opacity-0"
              }`}
              role="alert"
              aria-live="assertive"
            >
              <p className="text-red-500 text-sm text-center">{error}</p>
            </div>

            <button
              onClick={handleClose}
              className="mt-4 w-full text-sm text-gray-400 hover:text-gray-700 transition-colors focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:outline-none rounded py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
});
