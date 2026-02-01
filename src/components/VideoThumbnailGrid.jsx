import { useState, useEffect, useRef, useCallback } from 'react';
import { generateVideoThumbnail, getCachedThumbnail } from '../utils/videoThumbnails';

const getElectronAPI = () => window.electronAPI || null;

export const VideoThumbnailGrid = ({
  files,
  currentIndex,
  onSelectVideo,
  size = 'medium'
}) => {
  const sizes = { small: 128, medium: 192, large: 256 };
  const thumbSize = sizes[size] || sizes.medium;

  const [thumbnails, setThumbnails] = useState({});
  const generatingRef = useRef(new Set());
  const failedRef = useRef(new Set());

  useEffect(() => {
    setThumbnails({});
    generatingRef.current.clear();
    failedRef.current.clear();
  }, [files]);

  useEffect(() => {
    if (files.length === 0) return;

    let cancelled = false;

    const generateThumbnails = async () => {
      for (const file of files) {
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

    generateThumbnails();
    return () => { cancelled = true; };
  }, [files]);

  const getFileName = useCallback((filePath) => {
    const electronAPI = getElectronAPI();
    if (electronAPI?.path?.basename) {
      return electronAPI.path.basename(filePath);
    }
    return filePath.split(/[\\/]/).pop() || filePath;
  }, []);

  if (files.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.4)'
      }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 16 }}>
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
          <polygon points="10 8 16 12 10 16 10 8" />
        </svg>
        <p style={{ fontSize: 18 }}>Open a folder to browse videos</p>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      overflowY: 'auto', overflowX: 'hidden',
      padding: 16, background: '#0a0a0a'
    }}>
      <div style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`
      }}>
        {files.map((file, index) => {
          const isCurrent = index === currentIndex;
          const thumb = thumbnails[file];
          const fileName = getFileName(file);

          return (
            <div
              key={file}
              role="button"
              tabIndex={0}
              onClick={() => onSelectVideo(index)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectVideo(index); }}
              aria-label={`Play video ${fileName}`}
              style={{
                position: 'relative',
                cursor: 'pointer',
                borderRadius: 8,
                overflow: 'hidden',
                background: 'rgba(0,0,0,0.5)',
                aspectRatio: '16/9',
                outline: isCurrent ? '2px solid #3b82f6' : 'none',
                outlineOffset: -2,
                transform: isCurrent ? 'scale(1.03)' : undefined,
                transition: 'transform 0.2s, outline 0.2s'
              }}
              onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.transform = 'scale(1.03)'; }}
              onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.transform = ''; }}
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt={fileName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  draggable={false}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.3)'
                }}>
                  <div style={{
                    width: 24, height: 24,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'rgba(255,255,255,0.8)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                </div>
              )}

              {/* Index badge */}
              <div style={{
                position: 'absolute', top: 6, left: 6,
                background: 'rgba(0,0,0,0.6)',
                padding: '2px 6px', borderRadius: 4,
                fontSize: 10, color: 'rgba(255,255,255,0.7)'
              }}>
                {index + 1}
              </div>

              {/* File name overlay */}
              <div style={{
                position: 'absolute', inset: '0',
                display: 'flex', alignItems: 'flex-end',
                background: 'linear-gradient(transparent 60%, rgba(0,0,0,0.8))',
                padding: 8, opacity: 0,
                transition: 'opacity 0.2s'
              }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                onMouseLeave={(e) => e.currentTarget.style.opacity = 0}
              >
                <p style={{
                  fontSize: 12, color: 'rgba(255,255,255,0.9)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  width: '100%'
                }}>{fileName}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
