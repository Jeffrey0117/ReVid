import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { generateVideoThumbnail, getCachedThumbnail } from '../utils/videoThumbnails';

const getElectronAPI = () => window.electronAPI || null;

const FILMSTRIP_HEIGHT_KEY = 'revid-filmstrip-height';
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 200;
const DEFAULT_HEIGHT = 100;

export const VideoFilmstrip = ({
  files,
  currentIndex,
  onSelect
}) => {
  const scrollContainerRef = useRef(null);
  const heightRef = useRef(null);

  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem(FILMSTRIP_HEIGHT_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_HEIGHT && parsed <= MAX_HEIGHT) return parsed;
    }
    return DEFAULT_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => { heightRef.current = height; }, [height]);

  const [thumbnails, setThumbnails] = useState({});
  const generatingRef = useRef(new Set());
  const failedRef = useRef(new Set());

  const thumbHeight = height - 32;
  const thumbWidth = Math.round(thumbHeight * 16 / 9);

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

  // Auto-scroll to current item
  const prevFilesRef = useRef(files);
  const isInitialMount = useRef(true);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || currentIndex < 0 || files.length === 0) return;

    const albumChanged = prevFilesRef.current !== files;
    prevFilesRef.current = files;

    const shouldInstant = isInitialMount.current || albumChanged;
    if (isInitialMount.current) isInitialMount.current = false;

    const itemWidth = thumbWidth + 12;
    const scrollPos = currentIndex * itemWidth;

    if (shouldInstant) {
      container.scrollLeft = Math.max(0, scrollPos - container.clientWidth / 2 + itemWidth / 2);
    } else {
      const timeoutId = setTimeout(() => {
        container.scrollTo({
          left: Math.max(0, scrollPos - container.clientWidth / 2 + itemWidth / 2),
          behavior: 'smooth'
        });
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [currentIndex, thumbWidth, files]);

  // Resize handle (drag top edge)
  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      const windowH = window.innerHeight;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, windowH - e.clientY));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(FILMSTRIP_HEIGHT_KEY, heightRef.current.toString());
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
    if (electronAPI?.path?.basename) return electronAPI.path.basename(filePath);
    return filePath.split(/[\\/]/).pop() || filePath;
  }, []);

  return (
    <div style={{
      height, flexShrink: 0, width: '100%',
      background: 'rgba(255,255,255,0.03)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden'
    }}>
      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: 4,
          cursor: 'row-resize', zIndex: 50,
          background: isResizing ? '#3b82f6' : 'transparent',
          transition: 'background 0.15s'
        }}
        onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.background = 'rgba(255,255,255,0.3)'; }}
        onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.background = 'transparent'; }}
      />

      <div
        ref={scrollContainerRef}
        style={{
          flex: 1, display: 'flex', alignItems: 'center',
          gap: 12, padding: '8px 12px',
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', userSelect: 'none'
        }}
      >
        {files.map((file, index) => {
          const isActive = index === currentIndex;
          const thumb = thumbnails[file];
          const fileName = getFileName(file);

          return (
            <div
              key={file}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(index)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(index); }}
              aria-label={`Play video ${fileName}`}
              style={{
                flexShrink: 0, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                transition: 'transform 0.1s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = ''}
            >
              <div style={{
                width: thumbWidth, height: thumbHeight,
                borderRadius: 6, overflow: 'hidden',
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
                      width: 14, height: 14,
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: 'rgba(255,255,255,0.8)',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                  </div>
                )}

                {/* Index badge */}
                <div style={{
                  position: 'absolute', top: 3, left: 3,
                  background: 'rgba(0,0,0,0.6)',
                  padding: '1px 4px', borderRadius: 3,
                  fontSize: 9, color: 'rgba(255,255,255,0.7)'
                }}>
                  {index + 1}
                </div>
              </div>

              <div style={{
                marginTop: 2, fontSize: 9, fontWeight: 500,
                textAlign: 'center', width: thumbWidth, padding: '0 2px',
                color: isActive ? '#3b82f6' : 'rgba(255,255,255,0.6)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {fileName}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
