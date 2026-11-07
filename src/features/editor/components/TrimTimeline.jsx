import { useState, useRef, useCallback, useEffect } from 'react';
import { useI18n } from '../../../i18n.jsx';
import { useTheme } from '../../../theme.jsx';
import { ArrowDownToLine } from '../../../components/icons';

export const FRAME = 1 / 30; // nudge step; real fps isn't exposed by <video>, 30fps is a sane default
export const MIN_RANGE = 0.1;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function formatTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Frame-level trimming needs sub-second feedback — m:ss.cc (centiseconds).
export function formatTimePrecise(s) {
    if (!isFinite(s)) return '0:00.00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const cs = Math.floor((s - Math.floor(s)) * 100);
    return `${m}:${sec.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function NudgeButton({ label, title, onClick }) {
    const { theme } = useTheme();
    return (
        <button
            onClick={onClick}
            title={title}
            style={{
                width: 26, height: 22, padding: 0, borderRadius: 4, fontSize: 12,
                background: theme.inputBg, color: theme.textSecondary,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
            }}
        >
            {label}
        </button>
    );
}

export function TrimTimeline({ duration, trimStart, trimEnd, currentTime, thumbnails, onTrimChange, onSeek, onScrubStart, contentWidth }) {
    const { t } = useI18n();
    const { theme } = useTheme();
    const trackRef = useRef(null);
    const seekRaf = useRef(0);
    const [dragging, setDragging] = useState(null);

    const getTimeFromX = useCallback((clientX) => {
        if (!trackRef.current) return 0;
        const rect = trackRef.current.getBoundingClientRect();
        const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
        return pct * duration;
    }, [duration]);

    // Seeking on every mousemove floods the decoder on heavy sources; one
    // seek per animation frame keeps the preview responsive instead.
    const previewSeek = useCallback((time) => {
        cancelAnimationFrame(seekRaf.current);
        seekRaf.current = requestAnimationFrame(() => onSeek(time));
    }, [onSeek]);

    useEffect(() => () => cancelAnimationFrame(seekRaf.current), []);

    const startDrag = useCallback((e, type) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(type);
        // Show the frame under the handle right away so the user sees what
        // they are about to cut on, not just a position on the track.
        onScrubStart?.();
        onSeek(type === 'start' ? trimStart : trimEnd);
    }, [onSeek, onScrubStart, trimStart, trimEnd]);

    useEffect(() => {
        if (!dragging) return;

        const onMove = (e) => {
            const time = getTimeFromX(e.clientX);
            if (dragging === 'start') {
                const start = clamp(time, 0, trimEnd - MIN_RANGE);
                onTrimChange({ start, end: trimEnd });
                previewSeek(start);
            } else if (dragging === 'end') {
                const end = clamp(time, trimStart + MIN_RANGE, duration);
                onTrimChange({ start: trimStart, end });
                previewSeek(end);
            }
        };
        // Land exactly on the final handle position, bypassing the throttle.
        const onUp = (e) => {
            const time = getTimeFromX(e.clientX);
            cancelAnimationFrame(seekRaf.current);
            if (dragging === 'start') onSeek(clamp(time, 0, trimEnd - MIN_RANGE));
            else if (dragging === 'end') onSeek(clamp(time, trimStart + MIN_RANGE, duration));
            setDragging(null);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [dragging, trimStart, trimEnd, duration, getTimeFromX, onTrimChange, onSeek, previewSeek]);

    const handleTrackClick = useCallback((e) => {
        if (e.target.closest('[data-handle]')) return;
        onSeek(getTimeFromX(e.clientX));
    }, [getTimeFromX, onSeek]);

    const nudgeStart = useCallback((delta) => {
        const start = clamp(trimStart + delta, 0, trimEnd - MIN_RANGE);
        onTrimChange({ start, end: trimEnd });
        onSeek(start);
    }, [trimStart, trimEnd, onTrimChange, onSeek]);

    const nudgeEnd = useCallback((delta) => {
        const end = clamp(trimEnd + delta, trimStart + MIN_RANGE, duration);
        onTrimChange({ start: trimStart, end });
        onSeek(end);
    }, [trimStart, trimEnd, duration, onTrimChange, onSeek]);

    const setStartToPlayhead = useCallback(() => {
        onTrimChange({ start: clamp(currentTime, 0, trimEnd - MIN_RANGE), end: trimEnd });
    }, [currentTime, trimEnd, onTrimChange]);

    const setEndToPlayhead = useCallback(() => {
        onTrimChange({ start: trimStart, end: clamp(currentTime, trimStart + MIN_RANGE, duration) });
    }, [currentTime, trimStart, duration, onTrimChange]);

    if (!duration) return null;

    const startPct = (trimStart / duration) * 100;
    const endPct = (trimEnd / duration) * 100;
    const playPct = clamp((currentTime / duration) * 100, 0, 100);
    const selectedDuration = trimEnd - trimStart;

    return (
        <div style={{ padding: '8px 16px', background: theme.bgSecondary, borderTop: `1px solid ${theme.border}` }}>
            {/* Align with the displayed video width: a full-bleed track under a
                letterboxed video reads as two unrelated layouts. */}
            <div style={{ maxWidth: contentWidth || '100%', margin: '0 auto' }}>
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
                    borderTop: `2px solid ${theme.accent}`, borderBottom: `2px solid ${theme.accent}`,
                    boxSizing: 'border-box', pointerEvents: 'none'
                }} />

                {/* Trim start handle */}
                <div
                    data-handle="start"
                    style={{
                        position: 'absolute', left: `${startPct}%`, top: 0,
                        width: 10, height: '100%', marginLeft: -5,
                        background: theme.accent, cursor: 'ew-resize',
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
                        background: theme.accent, cursor: 'ew-resize',
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

            {/* One control row: each trim point's time sits WITH its own
                nudge buttons, selected duration in the middle. */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginTop: 8, gap: 8
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, color: theme.textTertiary }}>{t('editorStart')}</span>
                    <span style={{
                        fontSize: 12, color: theme.textSecondary,
                        fontVariantNumeric: 'tabular-nums', margin: '0 4px', minWidth: 58
                    }}>
                        {formatTimePrecise(trimStart)}
                    </span>
                    <NudgeButton label={'−'} title="-1/30s" onClick={() => nudgeStart(-FRAME)} />
                    <NudgeButton label={'+'} title="+1/30s" onClick={() => nudgeStart(FRAME)} />
                    <NudgeButton label={<ArrowDownToLine size={12} />} title={t('editorSetStart')} onClick={setStartToPlayhead} />
                </div>

                <div style={{
                    textAlign: 'center',
                    fontSize: 11, color: theme.textTertiary, fontVariantNumeric: 'tabular-nums'
                }}>
                    {t('editorSelected')}{' '}
                    <span style={{ color: theme.textSecondary, fontSize: 12 }}>
                        {formatTimePrecise(selectedDuration)}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <NudgeButton label={<ArrowDownToLine size={12} />} title={t('editorSetEnd')} onClick={setEndToPlayhead} />
                    <NudgeButton label={'−'} title="-1/30s" onClick={() => nudgeEnd(-FRAME)} />
                    <NudgeButton label={'+'} title="+1/30s" onClick={() => nudgeEnd(FRAME)} />
                    <span style={{
                        fontSize: 12, color: theme.textSecondary,
                        fontVariantNumeric: 'tabular-nums', margin: '0 4px', minWidth: 58, textAlign: 'right'
                    }}>
                        {formatTimePrecise(trimEnd)}
                    </span>
                    <span style={{ fontSize: 11, color: theme.textTertiary }}>{t('editorEnd')}</span>
                </div>
            </div>
            </div>
        </div>
    );
}
