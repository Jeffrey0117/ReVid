import { useState, useEffect, useRef, useCallback } from 'react';
import { generateVideoThumbnail, getCachedThumbnail } from '../utils/videoThumbnails';
import { getVideoMetadata } from '../utils/videoMetadata';
import { toLocalVideoUrl } from '../utils/localVideoUrl';
import { VideoGridCell } from './VideoGridCell';
import { useTheme } from '../theme.jsx';

const getElectronAPI = () => window.electronAPI || null;

// Thumbnails/metadata are generated only for cells near the viewport,
// at most this many at a time (each one spins up a hidden <video>).
const MAX_CONCURRENT_GENERATIONS = 3;

// Drop entries whose file is no longer displayed; keep the rest so
// re-sorting/filtering doesn't regenerate anything.
const pruneToFiles = (prev, fileSet) => {
  const keys = Object.keys(prev);
  if (keys.every(k => fileSet.has(k))) return prev;
  const next = {};
  for (const k of keys) {
    if (fileSet.has(k)) next[k] = prev[k];
  }
  return next;
};

export const VideoThumbnailGrid = ({
  files,
  currentIndex,
  onSelectVideo,
  size = 'medium',
  isPinned,
  onTogglePin
}) => {
  const { theme, isDark } = useTheme();
  const sizes = { small: 128, medium: 192, large: 256 };
  const thumbSize = sizes[size] || sizes.medium;

  const [thumbnails, setThumbnails] = useState({});
  const [metadata, setMetadata] = useState({});
  const [hoverIndex, setHoverIndex] = useState(-1);
  const hoverVideoRef = useRef(null);
  const hoverTimeoutRef = useRef(null);

  const scrollRef = useRef(null);
  const observerRef = useRef(null);
  const cellCallbacksRef = useRef(new Map());
  const filesSetRef = useRef(new Set(files));
  const doneRef = useRef(new Set());
  const queuedRef = useRef(new Set());
  const queueRef = useRef([]);
  const activeRef = useRef(0);

  // File list changed (folder/sort/filter): prune caches down to the files
  // still shown. Entries that survive keep their thumbnails — no regeneration.
  useEffect(() => {
    const fileSet = new Set(files);
    filesSetRef.current = fileSet;
    doneRef.current = new Set([...doneRef.current].filter(f => fileSet.has(f)));
    queueRef.current = queueRef.current.filter(f => fileSet.has(f));
    queuedRef.current = new Set([...queuedRef.current].filter(f => fileSet.has(f)));
    setThumbnails(prev => pruneToFiles(prev, fileSet));
    setMetadata(prev => pruneToFiles(prev, fileSet));
  }, [files]);

  const processFile = useCallback(async (file) => {
    const videoUrl = toLocalVideoUrl(file);

    const thumb = getCachedThumbnail(videoUrl) || await generateVideoThumbnail(videoUrl);
    if (!filesSetRef.current.has(file)) return;
    if (thumb) {
      setThumbnails(prev => (prev[file] === thumb ? prev : { ...prev, [file]: thumb }));
    }

    const meta = await getVideoMetadata(videoUrl);
    if (!filesSetRef.current.has(file)) return;
    if (meta) {
      const api = getElectronAPI();
      const fileSize = api?.getFileSize ? api.getFileSize(file) : 0;
      setMetadata(prev => ({ ...prev, [file]: { ...meta, fileSize } }));
    }

    doneRef.current.add(file);
  }, []);

  const pumpQueue = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT_GENERATIONS && queueRef.current.length > 0) {
      const file = queueRef.current.shift();
      activeRef.current += 1;
      processFile(file)
        .catch(() => {})
        .finally(() => {
          activeRef.current -= 1;
          queuedRef.current.delete(file);
          pumpQueue();
        });
    }
  }, [processFile]);

  // Called by cells when they come near the viewport.
  const requestFileData = useCallback((file) => {
    if (doneRef.current.has(file) || queuedRef.current.has(file)) return;
    queuedRef.current.add(file);
    queueRef.current.push(file);
    pumpQueue();
  }, [pumpQueue]);

  // Shared IntersectionObserver. Created lazily on first cell registration
  // (cell effects run before this component's own effects on mount).
  const registerCell = useCallback((el, onVisible) => {
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      onVisible();
      return undefined;
    }
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = cellCallbacksRef.current.get(entry.target);
          if (cb) {
            cellCallbacksRef.current.delete(entry.target);
            observerRef.current.unobserve(entry.target);
            cb();
          }
        }
      }, { root: scrollRef.current, rootMargin: '300px' });
    }
    cellCallbacksRef.current.set(el, onVisible);
    observerRef.current.observe(el);
    return () => {
      cellCallbacksRef.current.delete(el);
      observerRef.current?.unobserve(el);
    };
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Hover preview: create/destroy video element
  const handleHoverStart = useCallback((file, index) => {
    clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverIndex(index);
      const videoUrl = toLocalVideoUrl(file);
      if (hoverVideoRef.current) {
        hoverVideoRef.current.pause();
        hoverVideoRef.current.removeAttribute('src');
        hoverVideoRef.current.load();
      }
      const container = document.querySelector(`[data-grid-item="${index}"]`);
      if (!container) return;

      // Remove any existing hover video
      const existing = container.querySelector('.hover-preview');
      if (existing) existing.remove();

      const vid = document.createElement('video');
      vid.className = 'hover-preview';
      vid.src = videoUrl;
      vid.muted = true;
      vid.autoplay = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;pointer-events:none;';
      container.appendChild(vid);
      hoverVideoRef.current = vid;
    }, 400);
  }, []);

  const handleHoverEnd = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current);
    setHoverIndex(-1);
    if (hoverVideoRef.current) {
      hoverVideoRef.current.pause();
      hoverVideoRef.current.remove();
      hoverVideoRef.current = null;
    }
  }, []);

  const getFileName = useCallback((filePath) => {
    const api = getElectronAPI();
    if (api?.path?.basename) return api.path.basename(filePath);
    return filePath.split(/[\\/]/).pop() || filePath;
  }, []);

  return (
    <div ref={scrollRef} style={{
      width: '100%', height: '100%',
      overflowY: 'auto', overflowX: 'hidden',
      padding: 16, background: isDark ? '#0a0a0a' : '#f3f4f6'
    }}>
      {files.length === 0 ? (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: theme.textTertiary
        }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 16 }}>
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
            <polygon points="10 8 16 12 10 16 10 8" />
          </svg>
          <p style={{ fontSize: 18 }}>Open a folder to browse videos</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gap: 20,
          padding: 12,
          gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`
        }}>
          {files.map((file, index) => (
            <VideoGridCell
              key={file}
              file={file}
              index={index}
              fileName={getFileName(file)}
              isCurrent={index === currentIndex}
              pinned={isPinned ? !!isPinned(file) : false}
              showPin={!!onTogglePin}
              hovered={hoverIndex === index}
              thumb={thumbnails[file]}
              meta={metadata[file]}
              onSelect={onSelectVideo}
              onTogglePin={onTogglePin}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
              registerCell={registerCell}
              onRequestData={requestFileData}
            />
          ))}
        </div>
      )}
    </div>
  );
};
