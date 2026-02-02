import { useState, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'revid-pinned-files';

function loadPins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function savePins(pins) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...pins]));
}

export const usePins = () => {
  const [pinnedSet, setPinnedSet] = useState(loadPins);

  const togglePin = useCallback((filePath) => {
    setPinnedSet(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      savePins(next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (filePath) => pinnedSet.has(filePath),
    [pinnedSet]
  );

  const pinnedCount = useMemo(() => pinnedSet.size, [pinnedSet]);

  const clearPins = useCallback(() => {
    setPinnedSet(new Set());
    savePins(new Set());
  }, []);

  return { isPinned, togglePin, pinnedSet, pinnedCount, clearPins };
};
