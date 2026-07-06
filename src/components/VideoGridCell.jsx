import { useState, useEffect, useRef, memo } from 'react';
import { formatDuration, formatFileSize } from '../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

/**
 * One grid cell. Memoized so thumbnail/metadata updates for other files
 * don't re-render it. Renders a lightweight placeholder until the shared
 * IntersectionObserver (via registerCell) reports it near the viewport,
 * then asks the grid to generate its thumbnail/metadata (onRequestData).
 */
export const VideoGridCell = memo(function VideoGridCell({
  file,
  index,
  fileName,
  isCurrent,
  pinned,
  showPin,
  hovered,
  thumb,
  meta,
  onSelect,
  onTogglePin,
  onHoverStart,
  onHoverEnd,
  registerCell,
  onRequestData
}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  // One-way latch: once near the viewport, stay "in view" (data stays mounted)
  useEffect(() => registerCell(ref.current, () => setInView(true)), [registerCell]);

  useEffect(() => {
    if (inView) onRequestData(file);
  }, [inView, file, onRequestData]);

  return (
    <div
      ref={ref}
      data-grid-item={index}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(index)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(index); }}
      onMouseEnter={() => onHoverStart(file, index)}
      onMouseLeave={onHoverEnd}
      draggable
      onDragStart={(e) => {
        e.preventDefault();
        const api = getElectronAPI();
        if (api?.startDrag) api.startDrag(file);
      }}
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
          {inView && (
            <div style={{
              width: 24, height: 24,
              border: '2px solid rgba(255,255,255,0.3)',
              borderTopColor: 'rgba(255,255,255,0.8)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
          )}
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

      {/* Pin button */}
      {showPin && inView && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(file); }}
          style={{
            position: 'absolute', bottom: 6, right: 6, zIndex: 4,
            width: 24, height: 24, borderRadius: '50%',
            background: pinned ? 'rgba(251,191,36,0.9)' : 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: pinned ? 1 : (hovered ? 0.8 : 0),
            transition: 'opacity 0.2s',
            pointerEvents: 'auto'
          }}
          title={pinned ? 'Unpin' : 'Pin'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={pinned ? '#fff' : 'none'} stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </button>
      )}

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
      {inView && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 3,
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          background: 'linear-gradient(transparent 50%, rgba(0,0,0,0.85))',
          padding: 8, opacity: hovered ? 1 : 0,
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
      )}
    </div>
  );
});
