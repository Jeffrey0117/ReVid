import { useState, useEffect, useRef, useCallback } from 'react';
import { generateVideoThumbnail, getCachedThumbnail } from '../utils/videoThumbnails';
import { getVideoMetadata, formatDuration, formatFileSize } from '../utils/videoMetadata';

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
  const [metadata, setMetadata] = useState({});
  const [hoverIndex, setHoverIndex] = useState(-1);
  const hoverVideoRef = useRef(null);
  const hoverTimeoutRef = useRef(null);
  const generatingRef = useRef(new Set());
  const failedRef = useRef(new Set());

  useEffect(() => {
    setThumbnails({});
    setMetadata({});
    generatingRef.current.clear();
    failedRef.current.clear();
  }, [files]);

  // Generate thumbnails + metadata progressively
  useEffect(() => {
    if (files.length === 0) return;
    let cancelled = false;

    const generate = async () => {
      for (const file of files) {
        if (cancelled) break;
        if (generatingRef.current.has(file) || failedRef.current.has(file)) continue;

        generatingRef.current.add(file);

        const videoUrl = `local-video:///${file.replace(/\\/g, '/')}`;

        // Thumbnail
        const cached = getCachedThumbnail(videoUrl);
        if (cached) {
          if (!cancelled) setThumbnails(prev => prev[file] ? prev : { ...prev, [file]: cached });
        } else {
          const thumb = await generateVideoThumbnail(videoUrl);
          if (cancelled) break;
          if (thumb) {
            setThumbnails(prev => ({ ...prev, [file]: thumb }));
          } else {
            failedRef.current.add(file);
          }
        }

        // Metadata
        const meta = await getVideoMetadata(videoUrl);
        if (cancelled) break;
        if (meta) {
          const api = getElectronAPI();
          const fileSize = api?.getFileSize ? api.getFileSize(file) : 0;
          setMetadata(prev => ({ ...prev, [file]: { ...meta, fileSize } }));
        }

        generatingRef.current.delete(file);
      }
    };

    generate();
    return () => { cancelled = true; };
  }, [files]);

  // Hover preview: create/destroy video element
  const handleHoverStart = useCallback((file, index) => {
    clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverIndex(index);
      const videoUrl = `local-video:///${file.replace(/\\/g, '/')}`;
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
          const meta = metadata[file];
          const fileName = getFileName(file);

          return (
            <div
              key={file}
              data-grid-item={index}
              role="button"
              tabIndex={0}
              onClick={() => onSelectVideo(index)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectVideo(index); }}
              onMouseEnter={() => handleHoverStart(file, index)}
              onMouseLeave={handleHoverEnd}
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
                position: 'absolute', top: 6, left: 6, zIndex: 3,
                background: 'rgba(0,0,0,0.6)',
                padding: '2px 6px', borderRadius: 4,
                fontSize: 10, color: 'rgba(255,255,255,0.7)'
              }}>
                {index + 1}
              </div>

              {/* Duration badge */}
              {meta && meta.duration > 0 && (
                <div style={{
                  position: 'absolute', top: 6, right: 6, zIndex: 3,
                  background: 'rgba(0,0,0,0.7)',
                  padding: '2px 6px', borderRadius: 4,
                  fontSize: 10, color: '#fff', fontVariantNumeric: 'tabular-nums'
                }}>
                  {formatDuration(meta.duration)}
                </div>
              )}

              {/* Bottom info overlay */}
              <div style={{
                position: 'absolute', inset: 0, zIndex: 3,
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                background: 'linear-gradient(transparent 50%, rgba(0,0,0,0.85))',
                padding: 8, opacity: hoverIndex === index ? 1 : 0,
                transition: 'opacity 0.2s', pointerEvents: 'none'
              }}>
                <p style={{
                  fontSize: 12, color: 'rgba(255,255,255,0.95)', fontWeight: 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>{fileName}</p>
                {meta && (
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                    {meta.width && meta.height ? `${meta.width}×${meta.height}` : ''}
                    {meta.fileSize ? ` · ${formatFileSize(meta.fileSize)}` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
