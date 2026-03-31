import { memo, useState, useEffect, useRef, useCallback } from "react";
import { deleteFace, batchThumbnails } from "../api";
import FaceRegister from "./FaceRegister";

/**
 * FaceCardSkeleton — exact-shape placeholder shown while faces are loading.
 * Prevents CLS by matching the real FaceCard dimensions.
 */
function FaceCardSkeleton() {
  return (
    <div className="flex items-center gap-3 bg-gray-700 rounded-xl px-3 py-2 border border-gray-600">
      <div className="w-10 h-10 rounded-full bg-gray-600 flex-shrink-0 animate-pulse" />
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="h-3 w-24 rounded bg-gray-600 animate-pulse" />
        <div className="h-2.5 w-14 rounded bg-gray-600 animate-pulse" />
      </div>
    </div>
  );
}

/**
 * FaceCard — memoized so only the targeted card re-renders on state changes.
 */
const FaceCard = memo(function FaceCard({
  face,
  thumbnail,
  isConfirming,
  isAddingAngle,
  onConfirmDelete,
  onDelete,
  onToggleAngle,
  onAngleSaved,
  onCancelAngle,
  cardRef,
}) {
  return (
    <div
      ref={cardRef}
      data-face-id={face.id}
      className="flex flex-col gap-1 bg-gray-700 rounded-xl px-3 py-2 border border-gray-600 hover:border-blue-400 transition-colors"
    >
      {/* Main row */}
      <div className="flex items-center gap-3">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={face.name}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gray-500 flex-shrink-0 animate-pulse" />
        )}

        <div className="flex-1 min-w-0">
          <span className="font-medium text-gray-100 text-sm truncate block">
            {face.name}
          </span>
          <span className="text-xs text-gray-400">
            {face.embedding_count ?? 0} angle
            {face.embedding_count !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onToggleAngle(face.id)}
            aria-label={`Add recognition angle for ${face.name}`}
            className="text-gray-400 hover:text-blue-400 transition-colors text-xs px-1 py-0.5 rounded focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
          >
            +
          </button>
          <button
            onClick={() => onConfirmDelete(isConfirming ? null : face.id)}
            aria-label={`Delete ${face.name}`}
            className="text-gray-400 hover:text-red-400 transition-colors text-lg leading-none px-1 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Inline delete confirmation */}
      {isConfirming && (
        <div className="flex items-center gap-2 pt-1 border-t border-gray-600 mt-1">
          <span className="text-xs text-red-400 flex-1">Delete {face.name}?</span>
          <button
            onClick={() => onDelete(face.id)}
            className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-0.5 rounded transition-colors active:scale-95"
          >
            Delete
          </button>
          <button
            onClick={() => onConfirmDelete(null)}
            className="text-xs text-gray-400 hover:text-gray-200 px-1 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:outline-none rounded"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Add-angle inline */}
      {isAddingAngle && (
        <FaceRegister
          targetPerson={{ id: face.id, name: face.name }}
          onSaved={onAngleSaved}
          onCancel={onCancelAngle}
        />
      )}
    </div>
  );
});

/**
 * FaceList renders the sidebar list of registered persons.
 *
 * - Skeleton cards while isLoading
 * - IntersectionObserver: fetches thumbnails only as cards scroll into view
 * - fetchVisible is stable (useRef Set for fetched IDs, no thumbnails state dep)
 * - All callbacks memoized; FaceCard memo is never defeated
 */
export default function FaceList({ faces, isLoading, onDeleted, onUpdated }) {
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [addingAngleTo, setAddingAngleTo] = useState(null);
  const [thumbnails, setThumbnails] = useState({});

  const cardRefs = useRef({});
  const pendingFetch = useRef(null);
  // Track fetched IDs in a ref so fetchVisible doesn't depend on thumbnails state
  const fetchedIds = useRef(new Set());

  // Stable debounced batch fetch — no state dependencies
  const fetchVisible = useCallback((ids) => {
    clearTimeout(pendingFetch.current);
    pendingFetch.current = setTimeout(async () => {
      const missing = ids.filter((id) => !fetchedIds.current.has(id));
      if (missing.length === 0) return;
      // Mark optimistically before fetch to prevent double-requests on rapid scroll
      missing.forEach((id) => fetchedIds.current.add(id));
      try {
        const map = await batchThumbnails(missing);
        setThumbnails((prev) => ({ ...prev, ...map }));
      } catch (e) {
        // Unmark on failure so cards can retry on next scroll
        missing.forEach((id) => fetchedIds.current.delete(id));
        console.error("Thumbnail batch fetch failed:", e);
      }
    }, 50);
  }, []); // stable — no state deps

  // Set up observer; reconnects only when faces list changes (not on thumbnail loads)
  useEffect(() => {
    // Clean up stale refs for faces that no longer exist
    const currentIds = new Set(faces.map((f) => f.id));
    Object.keys(cardRefs.current).forEach((id) => {
      if (!currentIds.has(id)) {
        delete cardRefs.current[id];
        fetchedIds.current.delete(id);
      }
    });

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleIds = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target.dataset.faceId);
        if (visibleIds.length > 0) fetchVisible(visibleIds);
      },
      { threshold: 0.1 },
    );

    Object.values(cardRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [faces, fetchVisible]);

  const handleDelete = useCallback(
    async (id) => {
      try {
        await deleteFace(id);
        onDeleted(id);
      } catch (e) {
        console.error("Delete failed:", e);
      } finally {
        setConfirmingDelete(null);
      }
    },
    [onDeleted],
  );

  const handleAngleSaved = useCallback(
    (updatedPerson) => {
      onUpdated(updatedPerson);
      setAddingAngleTo(null);
    },
    [onUpdated],
  );

  const handleToggleAngle = useCallback((id) => {
    setAddingAngleTo((prev) => (prev === id ? null : id));
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 mt-4">
        <FaceCardSkeleton />
        <FaceCardSkeleton />
        <FaceCardSkeleton />
      </div>
    );
  }

  if (faces.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 mt-8 text-center px-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-12 h-12 text-gray-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
          />
        </svg>
        <p className="text-sm text-gray-400 font-medium">No faces registered yet</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Press <span className="text-blue-400">+ Register New Face</span> above to add someone
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-4 overflow-y-auto max-h-[calc(100vh-14rem)] pr-1">
      {faces.map((face) => (
        <FaceCard
          key={face.id}
          face={face}
          thumbnail={thumbnails[face.id] ?? null}
          isConfirming={confirmingDelete === face.id}
          isAddingAngle={addingAngleTo === face.id}
          onConfirmDelete={setConfirmingDelete}
          onDelete={handleDelete}
          onToggleAngle={handleToggleAngle}
          onAngleSaved={handleAngleSaved}
          onCancelAngle={() => setAddingAngleTo(null)}
          cardRef={(el) => {
            cardRefs.current[face.id] = el;
          }}
        />
      ))}
    </div>
  );
}
