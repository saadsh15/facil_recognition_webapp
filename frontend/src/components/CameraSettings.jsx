import { useEffect, useState, useCallback } from "react";
import { getCameraSettings, updateCameraSettings } from "../api";

export default function CameraSettings({ onClose }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getCameraSettings()
      .then(setSettings)
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = useCallback((key, value) => {
    const numValue = Number(value);
    setSettings((prev) => ({
      ...prev,
      [key]: { ...prev[key], value: numValue },
    }));

    // Debounce the actual API call to prevent overwhelming the device/server
    clearTimeout(window._cameraSettingTimeout);
    window._cameraSettingTimeout = setTimeout(() => {
      updateCameraSettings({ [key]: numValue }).catch(console.error);
    }, 100);
  }, []);

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl text-slate-100 relative overflow-hidden">
        {/* Decorative glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-24 bg-indigo-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
                Lens Optimizer
              </h2>
              <p className="text-sm text-slate-400 mt-1">Adjust hardware sensor properties</p>
            </div>
            <button 
              onClick={onClose} 
              className="text-slate-400 hover:text-slate-200 p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-10 h-10 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
              <p className="font-semibold mb-1">Failed to load camera settings:</p>
              <p>{error}</p>
            </div>
          ) : Object.keys(settings).length === 0 ? (
            <div className="text-slate-400 text-sm text-center py-8">
              No adjustable hardware controls found for this device.
            </div>
          ) : (
            <div className="flex flex-col gap-6 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
              {Object.entries(settings).map(([key, config]) => (
                <div key={key} className="flex flex-col gap-2 group">
                  <div className="flex justify-between text-sm items-center">
                    <span className="font-medium text-slate-300 capitalize group-hover:text-indigo-300 transition-colors">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className="text-indigo-400 font-mono bg-slate-800 px-2 py-0.5 rounded text-xs">
                      {config.value}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={config.min}
                    max={config.max}
                    step={config.step}
                    value={config.value}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="w-full accent-indigo-500 bg-slate-800 h-2 rounded-lg appearance-none cursor-pointer hover:bg-slate-700 transition-colors"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>{config.min}</span>
                    <span>{config.max}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
