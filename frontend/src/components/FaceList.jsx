import { memo, useState, useEffect, useRef, useCallback } from "react";
import { deleteFace, batchThumbnails } from "../api";
import FaceRegister from "./FaceRegister";

/**
 * FaceCardSkeleton — exact-shape placeholder shown while faces are loading.
 */
function FaceCardSkeleton() {
  return (
    <div className="flex items-center gap-4 bg-slate-800/40 rounded-2xl px-4 py-3 border border-slate-700/50 shadow-sm relative overflow-hidden">
      {/* Shimmer effect */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-slate-700/10 to-transparent" />
      
      <div className="w-12 h-12 rounded-full bg-slate-700/50 flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-2.5">
        <div className="h-3.5 w-32 rounded bg-slate-700/50" />
        <div className="h-2.5 w-20 rounded bg-slate-700/50" />
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
      className="group flex flex-col gap-1 bg-slate-800/40 backdrop-blur-sm rounded-2xl p-3 border border-slate-700/50 hover:border-indigo-500/50 hover:bg-slate-800/80 transition-all duration-300 shadow-sm hover:shadow-indigo-500/10"
    >
      {/* Main row */}
      <div className="flex items-center gap-4">
        <div className="relative">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={face.name}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-slate-700 group-hover:ring-indigo-400/50 transition-all"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-slate-700/80 flex-shrink-0 animate-pulse ring-2 ring-slate-600" />
          )}
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-slate-800 rounded-full z-10"></div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span className="font-semibold text-slate-100 text-sm truncate block group-hover:text-indigo-300 transition-colors">
            {face.name}
          </span>
          <span className="text-xs text-slate-400 font-medium mt-0.5">
            <span className="text-indigo-400 mr-1">{face.embedding_count ?? 0}</span> 
            {face.embedding_count === 1 ? "angle" : "angles"}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            onClick={() => onToggleAngle(face.id)}
            title={`Add recognition angle for ${face.name}`}
            className="w-8 h-8 flex items-center justify-center bg-slate-700/50 hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-300 transition-all rounded-full focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={() => onConfirmDelete(isConfirming ? null : face.id)}
            title={`Delete ${face.name}`}
            className="w-8 h-8 flex items-center justify-center bg-slate-700/50 hover:bg-red-500/20 text-slate-300 hover:text-red-400 transition-all rounded-full focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Inline delete confirmation */}
      {isConfirming && (
        <div className="flex items-center gap-3 pt-3 pb-1 border-t border-slate-700/50 mt-2">
          <span className="text-xs text-red-400 font-medium flex-1">Permanently delete {face.name}?</span>
          <button
            onClick={() => onConfirmDelete(null)}
            className="text-xs font-medium text-slate-400 hover:text-slate-200 px-3 py-1.5 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none rounded-md bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onDelete(face.id)}
            className="text-xs font-bold bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white px-3 py-1.5 rounded-md transition-all active:scale-95 border border-red-500/30"
          >
            Confirm
          </button>
        </div>
      )}

      {/* Add-angle inline */}
      {isAddingAngle && (
        <div className="mt-2 pt-2 border-t border-slate-700/50">
          <FaceRegister
            targetPerson={{ id: face.id, name: face.name }}
            onSaved={onAngleSaved}
            onCancel={onCancelAngle}
          />
        </div>
      )}
    </div>
  );
});

export default function FaceList({ faces, isLoading, onDeleted, onUpdated }) {
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [addingAngleTo, setAddingAngleTo] = useState(null);
  const [thumbnails, setThumbnails] = useState({});

  const cardRefs = useRef({});
  const pendingFetch = useRef(null);
  const fetchedIds = useRef(new Set());

  const fetchVisible = useCallback((ids) => {
    clearTimeout(pendingFetch.current);
    pendingFetch.current = setTimeout(async () => {
      const missing = ids.filter((id) => !fetchedIds.current.has(id));
      if (missing.length === 0) return;
      missing.forEach((id) => fetchedIds.current.add(id));
      try {
        const map = await batchThumbnails(missing);
        setThumbnails((prev) => ({ ...prev, ...map }));
      } catch (e) {
        missing.forEach((id) => fetchedIds.current.delete(id));
        console.error("Thumbnail batch fetch failed:", e);
      }
    }, 50);
  }, []);

  useEffect(() => {
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
      <div className="flex flex-col gap-3 overflow-hidden">
        <FaceCardSkeleton />
        <FaceCardSkeleton />
        <FaceCardSkeleton />
        <FaceCardSkeleton />
        <FaceCardSkeleton />
      </div>
    );
  }

  if (faces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </div>
        <p className="text-base text-slate-300 font-semibold mb-1">Database Empty</p>
        <p className="text-sm text-slate-500 max-w-[200px]">
          Register a new face above to begin identification.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-2 pb-4 flex flex-col gap-3 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
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
