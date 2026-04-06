import { memo, useEffect, useRef, useState } from "react";

const RETRY_DELAY_MS = 3000;

export default memo(function VideoStream() {
  const imgRef = useRef(null);
  const retryTimer = useRef(null);
  const [status, setStatus] = useState("connecting"); // connecting | live | disconnected

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    function connect() {
      setStatus("connecting");
      // Cache-bust forces the browser to re-open the stream connection
      img.src = `/stream?t=${Date.now()}`;
    }

    function onLoad() {
      setStatus("live");
    }

    function onError() {
      setStatus("disconnected");
      retryTimer.current = setTimeout(connect, RETRY_DELAY_MS);
    }

    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    connect();

    return () => {
      clearTimeout(retryTimer.current);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
  }, []);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/50 shadow-2xl shadow-indigo-500/10 aspect-video flex items-center justify-center group ring-1 ring-white/5">
      {/* Decorative corners */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-indigo-500/50 rounded-tl-xl opacity-50 z-10 pointer-events-none transition-opacity group-hover:opacity-100" />
      <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-indigo-500/50 rounded-tr-xl opacity-50 z-10 pointer-events-none transition-opacity group-hover:opacity-100" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-indigo-500/50 rounded-bl-xl opacity-50 z-10 pointer-events-none transition-opacity group-hover:opacity-100" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-indigo-500/50 rounded-br-xl opacity-50 z-10 pointer-events-none transition-opacity group-hover:opacity-100" />

      <img
        ref={imgRef}
        alt="Live facial recognition feed"
        className={`w-full h-auto block object-cover transition-opacity duration-500 ${
          status === "live" ? "opacity-100" : "opacity-30 blur-sm scale-105"
        }`}
      />

      {/* Visually-hidden aria-live region — announces status to screen readers */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {status === "connecting"
          ? "Camera stream connecting"
          : status === "disconnected"
            ? `Stream lost, reconnecting in ${RETRY_DELAY_MS / 1000} seconds`
            : "Camera stream live"}
      </span>

      {/* Status overlay — shown when not live */}
      {status !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white bg-slate-950/40 backdrop-blur-sm z-20">
          {status === "connecting" && (
            <>
              <div className="relative flex h-10 w-10 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-40"></span>
                <span className="relative inline-flex rounded-full h-6 w-6 bg-indigo-500"></span>
              </div>
              <span className="text-sm font-medium tracking-wide text-indigo-200">Initializing Optical Sensor...</span>
            </>
          )}
          {status === "disconnected" && (
            <>
              <div className="p-4 bg-amber-500/10 rounded-full">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-8 h-8 text-amber-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
              <span className="text-sm font-medium text-amber-200">Connection Interrupted. Reacquiring target in {RETRY_DELAY_MS / 1000}s</span>
            </>
          )}
        </div>
      )}

      {/* LIVE badge & overlay elements */}
      {status === "live" && (
        <>
          <div className="absolute top-4 left-4 bg-red-500/20 border border-red-500/50 text-red-400 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md z-20 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)] inline-block" />
            LIVE FEED
          </div>
          
          <div className="absolute top-4 right-4 bg-slate-900/40 border border-white/10 backdrop-blur-md text-slate-300 text-[10px] uppercase font-mono px-2 py-1 rounded tracking-wider z-20">
            REC // 1080P // 30FPS
          </div>
          
          {/* Subtle scanning line effect */}
          <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px] pointer-events-none opacity-20 z-10 mix-blend-overlay"></div>
        </>
      )}
    </div>
  );
});
