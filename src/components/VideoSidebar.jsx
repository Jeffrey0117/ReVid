import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { generateVideoThumbnail, getCachedThumbnail } from '../utils/videoThumbnails';

const getElectronAPI = () => window.electronAPI || null;

const SIDEBAR_WIDTH_KEY = 'revid-sidebar-width';
const MIN_WIDTH = 80;
const MAX_WIDTH = 240;
const DEFAULT_WIDTH = 140;

export const VideoSidebar = ({
  files,
  currentIndex,
  onSelect
}) => {
  const scrollContainerRef = useRef(null);
  const widthRef = useRef(null);

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        return parsed;
      }
    }
    return DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => { widthRef.current = width; }, [width]);

  const [thumbnails, setThumbnails] = useState({});
  const generatingRef = useRef(new Set());
  const failedRef = useRef(new Set());

  const thumbSize = width - 24;

  const [scrollPosition, setScrollPosition] = useState(0);
  const [containerSize, setContainerSize] = useState(0);
  const ITEM_GAP = 12;
  const ITEM_HEIGHT = Math.round(thumbSize * 9 / 16) + 32 + ITEM_GAP;
  const OVERSCAN = 3;

  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollPosition / ITEM_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(containerSize / ITEM_HEIGHT) + OVERSCAN * 2;
    const endIndex = Math.min(files.length - 1, startIndex + visibleCount);
    return { startIndex, endIndex };
  }, [scrollPosition, containerSize, ITEM_HEIGHT, files.length]);

  const totalSize = files.length * ITEM_HEIGHT;

  const handleScroll = useCallback((e) => {
    setScrollPosition(e.target.scrollTop);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const updateSize = () => setContainerSize(container.clientHeight);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setThumbnails({});
    generatingRef.current.clear();
    failedRef.current.clear();
  }, [files]);

  useEffect(() => {
    if (files.length === 0) return;
    let cancelled = false;

    const generatePrioritized = async () => {
      const priorityFiles = [];
      for (let i = 0; i <= 10; i++) {
        if (currentIndex + i < files.length) priorityFiles.push(files[currentIndex + i]);
        if (i > 0 && currentIndex - i >= 0) priorityFiles.push(files[currentIndex - i]);
      }
      const remaining = files.filter(f => !priorityFiles.includes(f));
      const allFiles = [...priorityFiles, ...remaining];

      for (const file of allFiles) {
        if (cancelled) break;
        if (generatingRef.current.has(file) || failedRef.current.has(file)) continue;

        generatingRef.current.add(file);

        const videoUrl = `local-video:///${file.replace(/\\/g, '/')}`;
        const cached = getCachedThumbnail(videoUrl);
        if (cached) {
          if (!cancelled) {
            setThumbnails(prev => prev[file] ? prev : { ...prev, [file]: cached });
          }
          generatingRef.current.delete(file);
          continue;
        }

        const thumb = await generateVideoThumbnail(videoUrl);
        generatingRef.current.delete(file);

        if (cancelled) break;

        if (thumb) {
          setThumbnails(prev => ({ ...prev, [file]: thumb }));
        } else {
          failedRef.current.add(file);
        }
      }
    };

    generatePrioritized();
    return () => { cancelled = true; };
  }, [files, currentIndex]);

  const prevFilesRef = useRef(files);
  const isInitialMount = useRef(true);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || currentIndex < 0 || files.length === 0) return;

    const albumChanged = prevFilesRef.current !== files;
    prevFilesRef.current = files;

    const shouldInstant = isInitialMount.current || albumChanged;
    if (isInitialMount.current) isInitialMount.current = false;

    const scrollPos = currentIndex * ITEM_HEIGHT;

    if (shouldInstant) {
      container.scrollTop = Math.max(0, scrollPos - container.clientHeight / 2 + ITEM_HEIGHT / 2);
    } else {
      const timeoutId = setTimeout(() => {
        container.scrollTo({
          top: Math.max(0, scrollPos - container.clientHeight / 2 + ITEM_HEIGHT / 2),
          behavior: 'smooth'
        });
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [currentIndex, ITEM_HEIGHT, files]);

  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, widthRef.current.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const getFileName = useCallback((filePath) => {
    const electronAPI = getElectronAPI();
    if (electronAPI?.path?.basename) {
      return electronAPI.path.basename(filePath);
    }
    return filePath.split(/[\\/]/).pop() || filePath;
  }, []);

  return (
    <div style={{
      width, flexShrink: 0, height: '100%',
      background: 'rgba(255,255,255,0.03)',
      borderRight: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden'
    }}>
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1, position: 'relative',
          overflowY: 'auto', overflowX: 'hidden',
          userSelect: 'none',
          scrollbarWidth: 'none'
        }}
      >
        <div style={{ height: totalSize, width: '100%', position: 'relative' }}>
          {files.slice(visibleRange.startIndex, visibleRange.endIndex + 1).map((file, i) => {
            const index = visibleRange.startIndex + i;
            const isActive = index === currentIndex;
            const thumb = thumbnails[file];
            const fileName = getFileName(file);
            const thumbHeight = Math.round(thumbSize * 9 / 16);

            return (
              <div
                key={file}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(index)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(index); }}
                aria-label={`Play video ${fileName}`}
                style={{
                  position: 'absolute',
                  top: index * ITEM_HEIGHT + 8,
                  left: 12,
                  width: thumbSize,
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  transition: 'transform 0.1s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = ''}
              >
                <div style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.4)',
                  textAlign: 'center', width: '100%',
                  marginBottom: 4,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>
                  {index + 1}
                </div>

                <div style={{
                  width: thumbSize, height: thumbHeight,
                  borderRadius: 8, overflow: 'hidden',
                  border: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                  background: 'rgba(0,0,0,0.5)',
                  position: 'relative',
                  transition: 'border-color 0.2s'
                }}>
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                      draggable={false}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.2)'
                    }}>
                      <div style={{
                        width: 16, height: 16,
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: 'rgba(255,255,255,0.8)',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }} />
                    </div>
                  )}
                </div>

                <div style={{
                  marginTop: 4, fontSize: 10, fontWeight: 500,
                  textAlign: 'center', width: '100%', padding: '0 4px',
                  color: isActive ? '#3b82f6' : 'rgba(255,255,255,0.7)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>
                  {fileName}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute', top: 0, right: 0,
          width: 4, height: '100%',
          cursor: 'col-resize', zIndex: 50,
          background: isResizing ? '#3b82f6' : 'transparent',
          transition: 'background 0.15s'
        }}
        onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.background = 'rgba(255,255,255,0.3)'; }}
        onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.background = 'transparent'; }}
      />
    </div>
  );
};
