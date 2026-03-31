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
    <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-2xl aspect-video flex items-center justify-center">
      <img
        ref={imgRef}
        alt="Live facial recognition feed"
        className={`w-full h-auto block transition-opacity duration-300 ${
          status === "live" ? "opacity-100" : "opacity-30"
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
          {status === "connecting" && (
            <>
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Connecting to stream...</span>
            </>
          )}
          {status === "disconnected" && (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-8 h-8 text-yellow-400"
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
              <span className="text-sm">Stream lost — reconnecting in {RETRY_DELAY_MS / 1000}s</span>
            </>
          )}
        </div>
      )}

      {/* LIVE badge — only when actually live */}
      {status === "live" && (
        <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
          LIVE
        </div>
      )}
    </div>
  );
});
