import { useState, useEffect, useMemo, useCallback } from 'react';
import { getCachedMetadata } from '../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

const SORT_KEY = 'revid-sort-by';
const SORT_DIR_KEY = 'revid-sort-dir';
const FILTER_EXT_KEY = 'revid-filter-ext';

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
  { value: 'date', label: 'Date' },
  { value: 'duration', label: 'Duration' }
];

export { SORT_OPTIONS };

export const useSortFilter = (files) => {
  const [sortBy, setSortBy] = useState(() =>
    localStorage.getItem(SORT_KEY) || 'name'
  );
  const [sortDir, setSortDir] = useState(() =>
    localStorage.getItem(SORT_DIR_KEY) || 'asc'
  );
  const [filterExt, setFilterExt] = useState(() =>
    localStorage.getItem(FILTER_EXT_KEY) || 'all'
  );

  // Collect file stats (size, mtime) — synchronous via preload
  const [fileStats, setFileStats] = useState({});

  useEffect(() => {
    localStorage.setItem(SORT_KEY, sortBy);
  }, [sortBy]);
  useEffect(() => {
    localStorage.setItem(SORT_DIR_KEY, sortDir);
  }, [sortDir]);
  useEffect(() => {
    localStorage.setItem(FILTER_EXT_KEY, filterExt);
  }, [filterExt]);

  useEffect(() => {
    if (files.length === 0) {
      setFileStats({});
      return;
    }

    const api = getElectronAPI();
    if (!api?.getFileStat) return;

    const stats = {};
    for (const file of files) {
      stats[file] = api.getFileStat(file);
    }
    setFileStats(stats);
  }, [files]);

  // Available extensions from current files
  const availableExtensions = useMemo(() => {
    const api = getElectronAPI();
    const extSet = new Set();
    for (const file of files) {
      const ext = api?.path?.extname
        ? api.path.extname(file).toLowerCase()
        : (file.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      if (ext) extSet.add(ext);
    }
    return [...extSet].sort();
  }, [files]);

  // Filtered files
  const filteredFiles = useMemo(() => {
    if (filterExt === 'all') return files;
    const api = getElectronAPI();
    return files.filter(file => {
      const ext = api?.path?.extname
        ? api.path.extname(file).toLowerCase()
        : (file.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      return ext === filterExt;
    });
  }, [files, filterExt]);

  // Sort
  const displayFiles = useMemo(() => {
    const sorted = [...filteredFiles];
    const api = getElectronAPI();
    const dir = sortDir === 'asc' ? 1 : -1;

    const getName = (f) => {
      if (api?.path?.basename) return api.path.basename(f).toLowerCase();
      return (f.split(/[\\/]/).pop() || f).toLowerCase();
    };

    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return dir * getName(a).localeCompare(getName(b), undefined, { numeric: true });

        case 'size': {
          const sA = fileStats[a]?.size || 0;
          const sB = fileStats[b]?.size || 0;
          return dir * (sA - sB);
        }

        case 'date': {
          const dA = fileStats[a]?.mtimeMs || 0;
          const dB = fileStats[b]?.mtimeMs || 0;
          return dir * (dA - dB);
        }

        case 'duration': {
          const urlA = `local-video:///${a.replace(/\\/g, '/')}`;
          const urlB = `local-video:///${b.replace(/\\/g, '/')}`;
          const metaA = getCachedMetadata(urlA);
          const metaB = getCachedMetadata(urlB);
          const durA = metaA?.duration || 0;
          const durB = metaB?.duration || 0;
          return dir * (durA - durB);
        }

        default:
          return 0;
      }
    });

    return sorted;
  }, [filteredFiles, sortBy, sortDir, fileStats]);

  // Index mapping: original files index <-> display index
  const indexMap = useMemo(() => {
    const originalToDisplay = new Map();
    const displayToOriginal = new Map();

    for (let di = 0; di < displayFiles.length; di++) {
      const file = displayFiles[di];
      const oi = files.indexOf(file);
      if (oi >= 0) {
        originalToDisplay.set(oi, di);
        displayToOriginal.set(di, oi);
      }
    }

    return { originalToDisplay, displayToOriginal };
  }, [files, displayFiles]);

  const originalIndexOf = useCallback(
    (displayIdx) => indexMap.displayToOriginal.get(displayIdx) ?? -1,
    [indexMap]
  );

  const displayIndexOf = useCallback(
    (originalIdx) => indexMap.originalToDisplay.get(originalIdx) ?? -1,
    [indexMap]
  );

  const toggleSortDir = useCallback(() => {
    setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
  }, []);

  return {
    displayFiles,
    sortBy,
    setSortBy,
    sortDir,
    toggleSortDir,
    filterExt,
    setFilterExt,
    availableExtensions,
    originalIndexOf,
    displayIndexOf
  };
};
