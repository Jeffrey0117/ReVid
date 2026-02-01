import { useState, useRef, useCallback, useEffect } from 'react';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function formatTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function TrimTimeline({ duration, trimStart, trimEnd, currentTime, thumbnails, onTrimChange, onSeek }) {
    const trackRef = useRef(null);
    const [dragging, setDragging] = useState(null);

    const getTimeFromX = useCallback((clientX) => {
        if (!trackRef.current) return 0;
        const rect = trackRef.current.getBoundingClientRect();
        const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
        return pct * duration;
    }, [duration]);

    const startDrag = useCallback((e, type) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(type);
    }, []);

    useEffect(() => {
        if (!dragging) return;

        const onMove = (e) => {
            const time = getTimeFromX(e.clientX);
            if (dragging === 'start') {
                onTrimChange({ start: clamp(time, 0, trimEnd - 0.1), end: trimEnd });
            } else if (dragging === 'end') {
                onTrimChange({ start: trimStart, end: clamp(time, trimStart + 0.1, duration) });
            }
        };
        const onUp = () => setDragging(null);

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [dragging, trimStart, trimEnd, duration, getTimeFromX, onTrimChange]);

    const handleTrackClick = useCallback((e) => {
        if (e.target.closest('[data-handle]')) return;
        onSeek(getTimeFromX(e.clientX));
    }, [getTimeFromX, onSeek]);

    if (!duration) return null;

    const startPct = (trimStart / duration) * 100;
    const endPct = (trimEnd / duration) * 100;
    const playPct = clamp((currentTime / duration) * 100, 0, 100);
    const selectedDuration = trimEnd - trimStart;

    return (
        <div style={{ padding: '6px 16px 10px', background: 'rgba(255,255,255,0.02)' }}>
            {/* Time labels */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', marginBottom: 4,
                fontSize: 11, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums'
            }}>
                <span>{formatTime(trimStart)}</span>
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>{formatTime(currentTime)}</span>
                <span>{formatTime(trimEnd)}</span>
            </div>

            {/* Track */}
            <div
                ref={trackRef}
                style={{
                    position: 'relative', height: 44, borderRadius: 6,
                    overflow: 'hidden', cursor: 'pointer', background: '#111'
                }}
                onClick={handleTrackClick}
            >
                {/* Thumbnail strip */}
                {thumbnails && thumbnails.length > 0 && (
                    <div style={{ display: 'flex', height: '100%', width: '100%', position: 'absolute' }}>
                        {thumbnails.map((thumb, i) => (
                            <img
                                key={i} src={thumb} draggable={false}
                                style={{ height: '100%', flex: 1, objectFit: 'cover', opacity: 0.4 }}
                            />
                        ))}
                    </div>
                )}

                {/* Inactive region: left */}
                <div style={{
                    position: 'absolute', left: 0, top: 0,
                    width: `${startPct}%`, height: '100%',
                    background: 'rgba(0,0,0,0.7)'
                }} />

                {/* Inactive region: right */}
                <div style={{
                    position: 'absolute', right: 0, top: 0,
                    width: `${100 - endPct}%`, height: '100%',
                    background: 'rgba(0,0,0,0.7)'
                }} />

                {/* Active range border */}
                <div style={{
                    position: 'absolute',
                    left: `${startPct}%`, width: `${endPct - startPct}%`,
                    top: 0, height: '100%',
                    borderTop: '2px solid #3b82f6', borderBottom: '2px solid #3b82f6',
                    boxSizing: 'border-box', pointerEvents: 'none'
                }} />

                {/* Trim start handle */}
                <div
                    data-handle="start"
                    style={{
                        position: 'absolute', left: `${startPct}%`, top: 0,
                        width: 10, height: '100%', marginLeft: -5,
                        background: '#3b82f6', cursor: 'ew-resize',
                        borderRadius: '4px 0 0 4px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 2
                    }}
                    onMouseDown={(e) => startDrag(e, 'start')}
                >
                    <div style={{ width: 2, height: 18, background: 'rgba(255,255,255,0.7)', borderRadius: 1 }} />
                </div>

                {/* Trim end handle */}
                <div
                    data-handle="end"
                    style={{
                        position: 'absolute', left: `${endPct}%`, top: 0,
                        width: 10, height: '100%', marginLeft: -5,
                        background: '#3b82f6', cursor: 'ew-resize',
                        borderRadius: '0 4px 4px 0',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 2
                    }}
                    onMouseDown={(e) => startDrag(e, 'end')}
                >
                    <div style={{ width: 2, height: 18, background: 'rgba(255,255,255,0.7)', borderRadius: 1 }} />
                </div>

                {/* Playhead */}
                <div style={{
                    position: 'absolute', left: `${playPct}%`, top: 0,
                    width: 2, height: '100%', marginLeft: -1,
                    background: '#fff', pointerEvents: 'none', zIndex: 3
                }}>
                    <div style={{
                        position: 'absolute', top: -2, left: -3,
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#fff'
                    }} />
                </div>
            </div>

            {/* Selected duration */}
            <div style={{
                textAlign: 'center', marginTop: 4,
                fontSize: 11, color: 'rgba(255,255,255,0.3)'
            }}>
                {formatTime(selectedDuration)} selected{' '}
                {selectedDuration < duration && <span>/ {formatTime(duration)} total</span>}
            </div>
        </div>
    );
}
