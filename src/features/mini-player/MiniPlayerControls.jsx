import { useState } from 'react';
import { SpeedControl } from '../../components/SpeedControl';

const electronAPI = window.electronAPI || null;

/**
 * Controls overlay for the mini player window.
 * Shows speed indicator, opacity slider, and close button.
 */
export const MiniPlayerControls = ({
  speed,
  presets,
  onSelectSpeed,
  onClose
}) => {
  const [opacity, setOpacity] = useState(1);
  const [showOpacity, setShowOpacity] = useState(false);

  const handleOpacityChange = (e) => {
    const value = parseFloat(e.target.value);
    setOpacity(value);
    electronAPI?.setMiniPlayerOpacity?.(value);
  };

  return (
    <div className="absolute top-0 left-0 right-0 z-20 opacity-0 hover:opacity-100 transition-opacity duration-200">
      <div className="flex items-center justify-between px-2 py-1.5 bg-black/70 backdrop-blur-sm">
        {/* Speed control (compact) */}
        <SpeedControl
          speed={speed}
          presets={presets}
          onSelect={onSelectSpeed}
          compact
        />

        <div className="flex items-center gap-1.5">
          {/* Opacity toggle */}
          <button
            onClick={() => setShowOpacity(!showOpacity)}
            className="text-white/50 hover:text-white text-[10px] px-1.5 py-0.5 rounded transition-colors"
            title="Opacity"
          >
            {Math.round(opacity * 100)}%
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            className="text-white/50 hover:text-red-400 transition-colors p-0.5"
            title="Close mini player"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Opacity slider (toggled) */}
      {showOpacity && (
        <div className="px-2 py-1 bg-black/70 backdrop-blur-sm">
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={opacity}
            onChange={handleOpacityChange}
            className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:bg-primary
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
      )}
    </div>
  );
};
