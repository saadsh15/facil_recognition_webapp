import { useCallback, useEffect, useState } from "react";
import { getFaces } from "./api";
import FaceList from "./components/FaceList";
import FaceRegister from "./components/FaceRegister";
import VideoStream from "./components/VideoStream";

export default function App() {
  const [faces, setFaces] = useState([]);
  const [facesLoading, setFacesLoading] = useState(true);

  useEffect(() => {
    getFaces()
      .then(setFaces)
      .catch(console.error)
      .finally(() => setFacesLoading(false));
  }, []);

  const handleSaved = useCallback((newPerson) => {
    setFaces((prev) => {
      const exists = prev.find((f) => f.id === newPerson.id);
      if (exists) {
        return prev.map((f) => (f.id === newPerson.id ? newPerson : f));
      }
      return [newPerson, ...prev];
    });
  }, []);

  const handleDeleted = useCallback((id) => {
    setFaces((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="bg-gray-800 px-6 py-3 shadow flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
        <h1 className="text-lg font-bold tracking-tight">
          FaceRec — Real-Time Recognition
        </h1>
      </header>

      <main className="flex flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Live stream panel */}
        <section className="flex-1 flex items-center justify-center p-4 lg:p-6 min-h-0">
          <div className="w-full max-w-3xl">
            <VideoStream />
          </div>
        </section>

        {/* Sidebar */}
        <aside className="w-full lg:w-80 bg-gray-800 flex flex-col p-4 border-t lg:border-t-0 lg:border-l border-gray-700 overflow-y-auto">
          <h2 className="font-semibold text-sm uppercase tracking-widest text-gray-400 mb-3">
            Known Faces ({faces.length})
          </h2>
          <FaceRegister onSaved={handleSaved} />
          <FaceList
            faces={faces}
            isLoading={facesLoading}
            onDeleted={handleDeleted}
            onUpdated={handleSaved}
          />
        </aside>
      </main>
    </div>
  );
}
