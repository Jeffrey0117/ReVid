import { useState, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'revid-playback-speed';
const SPEED_PRESETS = [1, 1.25, 1.5, 2, 3];

const loadSpeed = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseFloat(stored);
      if (SPEED_PRESETS.includes(parsed)) return parsed;
    }
  } catch (e) {
    // Ignore storage errors
  }
  return 1;
};

/**
 * Hook for managing video playback speed with persistence.
 * Returns speed state and controls for cycling/selecting speed.
 */
export const usePlaybackSpeed = () => {
  const [speed, setSpeedState] = useState(loadSpeed);

  const setSpeed = useCallback((newSpeed) => {
    setSpeedState(newSpeed);
    try {
      localStorage.setItem(STORAGE_KEY, String(newSpeed));
    } catch (e) {
      // Ignore storage errors
    }
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedState((current) => {
      const currentIndex = SPEED_PRESETS.indexOf(current);
      const nextIndex = (currentIndex + 1) % SPEED_PRESETS.length;
      const next = SPEED_PRESETS[nextIndex];
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch (e) {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const selectSpeed = useCallback((newSpeed) => {
    if (SPEED_PRESETS.includes(newSpeed)) {
      setSpeed(newSpeed);
    }
  }, [setSpeed]);

  return useMemo(() => ({
    speed,
    cycleSpeed,
    selectSpeed,
    setSpeed,
    SPEED_PRESETS
  }), [speed, cycleSpeed, selectSpeed, setSpeed]);
};
