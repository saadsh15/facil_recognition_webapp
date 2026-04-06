import { useCallback, useEffect, useState } from "react";
import { getFaces } from "./api";
import FaceList from "./components/FaceList";
import FaceRegister from "./components/FaceRegister";
import VideoStream from "./components/VideoStream";
import CameraSettings from "./components/CameraSettings";

export default function App() {
  const [faces, setFaces] = useState([]);
  const [facesLoading, setFacesLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-900/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-900/20 blur-[120px]" />
      </div>

      <header className="relative z-10 bg-slate-900/50 backdrop-blur-md border-b border-slate-800/50 px-6 py-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative flex h-4 w-4 items-center justify-center">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
            FaceRec Studio
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-300 border border-slate-700 hover:border-indigo-500/50 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Adjust Lens
          </button>
          <div className="text-xs font-medium px-3 py-1.5 rounded-full bg-slate-800/50 border border-slate-700 text-slate-300">
            System Online
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Live stream panel */}
        <section className="flex-1 flex items-center justify-center p-4 lg:p-8 min-h-0 bg-slate-950/30">
          <div className="w-full max-w-4xl">
            <VideoStream />
          </div>
        </section>

        {/* Sidebar */}
        <aside className="w-full lg:w-96 bg-slate-900/80 backdrop-blur-xl flex flex-col p-6 border-t lg:border-t-0 lg:border-l border-slate-800/50 overflow-y-auto shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-semibold text-sm uppercase tracking-widest text-slate-400">
              Identity Database
            </h2>
            <span className="bg-slate-800 text-indigo-300 text-xs font-bold px-2 py-1 rounded-md">
              {faces.length} TOTAL
            </span>
          </div>
          
          <div className="mb-6">
            <FaceRegister onSaved={handleSaved} />
          </div>
          
          <div className="flex-1 overflow-hidden flex flex-col">
            <FaceList
              faces={faces}
              isLoading={facesLoading}
              onDeleted={handleDeleted}
              onUpdated={handleSaved}
            />
          </div>
        </aside>
      </main>

      {showSettings && <CameraSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
