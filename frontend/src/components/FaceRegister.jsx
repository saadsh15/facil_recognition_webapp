import { memo, useState, useEffect, useRef } from "react";
import { captureFrame, saveFace } from "../api";

/**
 * FaceRegister handles two registration modes:
 *   1. New person  — rendered as a full-width "+ Register New Face" button
 *   2. Add angle   — triggered by parent passing targetPerson={id, name}
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
  }, [open, stage]);

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
          className="w-full relative group overflow-hidden bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-300 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none shadow-lg shadow-indigo-500/20"
        >
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
          <div className="flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            <span>Register New Face</span>
          </div>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
          aria-hidden="false"
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl text-slate-100 relative overflow-hidden"
          >
            {/* Modal decorative glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-24 bg-indigo-500/20 blur-3xl pointer-events-none" />

            <div className="relative z-10">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 id={headingId} className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
                    {isAddAngle ? "Add Recognition Angle" : "New Identity"}
                  </h2>
                  {isAddAngle && (
                    <p className="text-sm text-slate-400 mt-1">
                      For <span className="font-semibold text-slate-200">{targetPerson.name}</span>
                    </p>
                  )}
                </div>
                <button 
                  onClick={handleClose}
                  className="text-slate-400 hover:text-slate-200 p-1 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {stage === "idle" && (
                <div className="mt-6">
                  <p className="text-sm text-slate-400 mb-6 text-center">
                    Ensure your face is clearly visible in the camera before capturing.
                  </p>
                  <button
                    onClick={handleCapture}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-medium py-3 rounded-xl transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none shadow-lg shadow-emerald-500/20 flex justify-center items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                    </svg>
                    Capture from Stream
                  </button>
                </div>
              )}

              {stage === "capturing" && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                    <div className="absolute inset-0 border-4 border-emerald-500/20 border-b-emerald-400 rounded-full animate-[spin_1.5s_reverse_infinite]" />
                  </div>
                  <p className="text-sm font-medium text-slate-300">Scanning bio-metrics...</p>
                </div>
              )}

              {(stage === "naming" || stage === "saving") && thumbnail && (
                <div className="flex flex-col items-center gap-5 mt-4">
                  <div className="relative">
                    <img
                      src={thumbnail}
                      alt="Captured face"
                      className="w-28 h-28 rounded-full object-cover border-4 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.4)]"
                    />
                    <div className="absolute inset-0 rounded-full border border-white/20 pointer-events-none" />
                    <button
                      onClick={handleCapture}
                      className="absolute bottom-0 right-0 bg-slate-800 hover:bg-slate-700 text-slate-200 p-2 rounded-full border border-slate-600 shadow-lg transition-colors"
                      title="Retake photo"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  
                  {!isAddAngle && (
                    <div className="w-full relative">
                      <input
                        type="text"
                        placeholder="Enter full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        autoFocus
                      />
                    </div>
                  )}
                  
                  <button
                    onClick={handleSave}
                    disabled={stage === "saving" || (!isAddAngle && !name.trim())}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 disabled:opacity-50 disabled:active:scale-100 text-white font-medium py-3 rounded-xl transition-all duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none shadow-lg shadow-indigo-500/20 flex justify-center items-center gap-2"
                  >
                    {stage === "saving" ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving to Database...
                      </>
                    ) : isAddAngle ? (
                      "Save New Angle"
                    ) : (
                      "Register Identity"
                    )}
                  </button>
                </div>
              )}

              {/* Error message with smooth transition */}
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  error ? "max-h-24 opacity-100 mt-4" : "max-h-0 opacity-0"
                }`}
                role="alert"
                aria-live="assertive"
              >
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-red-400 text-sm leading-relaxed">{error}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
