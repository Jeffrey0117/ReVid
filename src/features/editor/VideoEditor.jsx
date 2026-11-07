import { useState, useRef, useCallback, useEffect } from 'react';
import { CropOverlay, getDefaultCrop, isFullFrameCrop } from './components/CropOverlay';
import { TrimTimeline, FRAME, MIN_RANGE, formatTime, formatTimePrecise } from './components/TrimTimeline';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { Play, Pause, VolumeOn, VolumeOff, StepBack, StepForward } from '../../components/icons';
import { getCachedThumbnail } from '../../utils/videoThumbnails';

// Must stay below FRAME, or a single-frame trim near the edges is treated
// as "no trim" and silently dropped from the export.
const TRIM_EPS = 0.005;
// A batch-cut template must be a real sub-segment: long enough to fingerprint
// reliably (short templates make false matches cheap over hours of audio),
// and not the whole video.
const MIN_TEMPLATE_SECONDS = 3;

const PRESETS = [
    { label: 'Free', ar: null },
    { label: '16:9', ar: 16 / 9 },
    { label: '9:16', ar: 9 / 16 },
    { label: '1:1', ar: 1 },
    { label: '4:3', ar: 4 / 3 },
    { label: '4:5', ar: 4 / 5 },
];

const getElectronAPI = () => window.electronAPI || null;

function getVideoDisplayRect(container, videoW, videoH) {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const vAr = videoW / videoH;
    const cAr = cw / ch;
    let dw, dh;
    if (vAr > cAr) { dw = cw; dh = cw / vAr; }
    else { dh = ch; dw = ch * vAr; }
    return { x: (cw - dw) / 2, y: (ch - dh) / 2, width: dw, height: dh };
}

// Timeline strips are expensive (a hidden video seek-decodes the whole file),
// so cache them keyed by src + file size: re-entering the editor is free, and
// a replaced-in-place file (same path, new size) misses the cache correctly.
const MAX_STRIP_CACHE = 20;
const stripCache = new Map();

function stripCacheGet(key) {
    return stripCache.get(key) || null;
}

function stripCachePut(key, thumbs) {
    if (stripCache.size >= MAX_STRIP_CACHE) {
        stripCache.delete(stripCache.keys().next().value);
    }
    stripCache.set(key, thumbs);
}

async function generateThumbnails(videoSrc, count = 15) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.src = videoSrc;

        video.onloadedmetadata = async () => {
            const dur = video.duration;
            if (!dur || !isFinite(dur)) { resolve([]); return; }

            const tw = 120;
            const th = Math.round(tw / (video.videoWidth / video.videoHeight));
            const canvas = document.createElement('canvas');
            canvas.width = tw;
            canvas.height = th;
            const ctx = canvas.getContext('2d');
            const thumbs = [];

            for (let i = 0; i < count; i++) {
                try {
                    video.currentTime = (i / count) * dur;
                    await new Promise((r) => { video.onseeked = r; });
                    ctx.drawImage(video, 0, 0, tw, th);
                    thumbs.push(canvas.toDataURL('image/jpeg', 0.4));
                } catch { break; }
            }

            video.src = '';
            resolve(thumbs);
        };
        video.onerror = () => resolve([]);
    });
}

// The editor only prepares an export job: App runs it in the background and
// shows a corner progress toast, so the user is back in the viewer right away.
export const VideoEditor = ({ videoSrc, videoPath, timeRef, onCancel, onExport, onBatchCut, exportBusy }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const containerRef = useRef(null);
    const videoRef = useRef(null);

    const [videoDims, setVideoDims] = useState(null);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [displayRect, setDisplayRect] = useState(null);
    const [aspectIdx, setAspectIdx] = useState(0);
    const [crop, setCrop] = useState(null);
    const [trimStart, setTrimStart] = useState(0);
    const [trimEnd, setTrimEnd] = useState(0);
    const [fastCut, setFastCut] = useState(false);
    const [replaceOriginal, setReplaceOriginal] = useState(false);
    const [thumbnails, setThumbnails] = useState([]);

    const aspectRatio = PRESETS[aspectIdx].ar;

    const updateDisplayRect = useCallback((dims) => {
        if (!containerRef.current || !dims) return;
        setDisplayRect(getVideoDisplayRect(containerRef.current, dims.width, dims.height));
    }, []);

    useEffect(() => {
        const v = videoRef.current;
        if (!v || !videoSrc) return;
        v.src = videoSrc;

        const onMeta = () => {
            const dims = { width: v.videoWidth, height: v.videoHeight };
            setVideoDims(dims);
            setDuration(v.duration);
            setTrimEnd(v.duration);
            setCrop(getDefaultCrop(dims.width, dims.height, null));
            updateDisplayRect(dims);
            // Continue from where the viewer was — editor and viewer should
            // feel like one player, not two.
            const saved = timeRef?.current;
            if (saved && saved.src === videoSrc && Number.isFinite(saved.time)) {
                v.currentTime = Math.min(saved.time, Math.max(0, v.duration - 0.05));
            }
        };

        v.addEventListener('loadedmetadata', onMeta);
        return () => v.removeEventListener('loadedmetadata', onMeta);
    }, [videoSrc, updateDisplayRect, timeRef]);

    // Timeline thumbnails: cached per file, and generated only after the main
    // video can play — the strip's seek-decoding must not compete with the
    // frame the user is actually waiting for.
    useEffect(() => {
        if (!videoSrc) return;
        const api = getElectronAPI();
        const cacheKey = `${videoSrc}:${api?.getFileSize?.(videoPath) ?? 0}`;
        const cached = stripCacheGet(cacheKey);
        if (cached) { setThumbnails(cached); return; }

        setThumbnails([]);
        let cancelled = false;
        const start = () => {
            if (cancelled) return;
            generateThumbnails(videoSrc).then(thumbs => {
                if (cancelled) return;
                if (thumbs.length) stripCachePut(cacheKey, thumbs);
                setThumbnails(thumbs);
            });
        };

        const v = videoRef.current;
        let timer = setTimeout(start, 1500); // fallback if canplay never fires
        const onCanPlay = () => {
            clearTimeout(timer);
            timer = setTimeout(start, 100);
        };
        v?.addEventListener('canplay', onCanPlay, { once: true });
        return () => {
            cancelled = true;
            clearTimeout(timer);
            v?.removeEventListener('canplay', onCanPlay);
        };
    }, [videoSrc, videoPath]);

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;

        const onTime = () => {
            setCurrentTime(v.currentTime);
            // Report the position back so closing the editor returns the
            // viewer to the frame being edited.
            if (timeRef) timeRef.current = { src: videoSrc, time: v.currentTime };
            // Loop the trimmed range only during playback. Snapping while
            // paused would fight manual seeks (scrubbing near/past the end).
            if (!v.paused && trimEnd > trimStart && v.currentTime >= trimEnd) {
                v.currentTime = trimStart;
            }
        };
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);

        v.addEventListener('timeupdate', onTime);
        v.addEventListener('play', onPlay);
        v.addEventListener('pause', onPause);
        return () => {
            v.removeEventListener('timeupdate', onTime);
            v.removeEventListener('play', onPlay);
            v.removeEventListener('pause', onPause);
        };
    }, [trimStart, trimEnd, videoSrc, timeRef]);

    useEffect(() => {
        if (!videoDims) return;
        const obs = new ResizeObserver(() => updateDisplayRect(videoDims));
        if (containerRef.current) obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, [videoDims, updateDisplayRect]);

    useEffect(() => {
        if (!videoDims) return;
        setCrop(getDefaultCrop(videoDims.width, videoDims.height, aspectRatio));
    }, [aspectRatio, videoDims]);

    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) v.play().catch(() => {}); else v.pause();
    }, []);

    const pauseVideo = useCallback(() => {
        const v = videoRef.current;
        if (v && !v.paused) v.pause();
    }, []);

    const stepFrame = useCallback((dir) => {
        const v = videoRef.current;
        if (!v || !duration) return;
        v.pause();
        v.currentTime = Math.max(0, Math.min(duration, v.currentTime + dir * FRAME));
    }, [duration]);

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setMuted(v.muted);
    }, []);

    const handleSeek = useCallback((time) => {
        const v = videoRef.current;
        if (v) v.currentTime = time;
    }, []);

    const handleTrimChange = useCallback(({ start, end }) => {
        // Adjusting a handle is frame-picking: pause so the preview frame
        // holds still instead of the loop guard pulling playback around.
        const v = videoRef.current;
        if (v && !v.paused) v.pause();
        setTrimStart(start);
        setTrimEnd(end);
    }, []);

    // Keyboard: Space play/pause, ←/→ frame step (Shift = 1s), [ ] set trim points.
    useEffect(() => {
        const onKey = (e) => {
            const v = videoRef.current;
            if (!v || !duration) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.code === 'Space') {
                e.preventDefault();
                if (v.paused) v.play().catch(() => {}); else v.pause();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const stepSize = e.shiftKey ? 1 : FRAME;
                const dir = e.key === 'ArrowLeft' ? -1 : 1;
                v.pause();
                v.currentTime = Math.max(0, Math.min(duration, v.currentTime + dir * stepSize));
            } else if (e.key === '[') {
                e.preventDefault();
                handleTrimChange({
                    start: Math.max(0, Math.min(v.currentTime, trimEnd - MIN_RANGE)),
                    end: trimEnd
                });
            } else if (e.key === ']') {
                e.preventDefault();
                handleTrimChange({
                    start: trimStart,
                    end: Math.min(duration, Math.max(v.currentTime, trimStart + MIN_RANGE))
                });
            }
        };

        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [duration, trimStart, trimEnd, handleTrimChange]);

    const isFullFrame = videoDims ? isFullFrameCrop(crop, videoDims.width, videoDims.height) : true;

    const selectionLength = trimEnd - trimStart;
    const hasTemplateSelection = duration > 0
        && selectionLength >= MIN_TEMPLATE_SECONDS
        && selectionLength < duration - 0.1;

    const handleExport = useCallback(async () => {
        if (!crop || !videoDims || !videoPath || exportBusy) return;

        const api = getElectronAPI();
        if (!api) return;

        const pixelCrop = {
            x: Math.round(crop.x),
            y: Math.round(crop.y),
            width: Math.round(crop.width),
            height: Math.round(crop.height)
        };
        pixelCrop.width = pixelCrop.width % 2 === 0 ? pixelCrop.width : pixelCrop.width - 1;
        pixelCrop.height = pixelCrop.height % 2 === 0 ? pixelCrop.height : pixelCrop.height - 1;

        const trimRange = (trimStart > TRIM_EPS || trimEnd < duration - TRIM_EPS)
            ? { startTime: trimStart, endTime: trimEnd }
            : null;
        const totalDuration = trimRange
            ? trimRange.endTime - trimRange.startTime
            : duration;

        const ext = api.path.extname(videoPath);
        const base = api.path.basename(videoPath, ext);
        const dir = api.path.dirname(videoPath);

        let outputPath;
        if (replaceOriginal) {
            if (!window.confirm(`${t('editorReplaceConfirm')}\n${api.path.basename(videoPath)}`)) return;
            // Encode to a temp file next to the source; main swaps it in on success.
            outputPath = api.path.join(dir, `${base}.revid-tmp.mp4`);
        } else {
            // Default the save dialog to the source video's folder, not Downloads.
            const suffix = isFullFrame ? '-trimmed' : '-cropped';
            const picked = await api.showSaveDialog(api.path.join(dir, `${base}${suffix}.mp4`));
            if (picked.canceled || !picked.filePath) return;
            outputPath = picked.filePath;
        }

        onExport({
            params: {
                inputPath: videoPath,
                outputPath,
                // Full-frame selection means no crop — skip the filter so the
                // backend can stream-copy or at least avoid pointless scaling.
                crop: isFullFrame ? null : pixelCrop,
                trim: trimRange,
                totalDuration,
                fastCopy: isFullFrame && fastCut,
                replaceOriginal
            },
            label: api.path.basename(replaceOriginal ? videoPath : outputPath)
        });
    }, [crop, videoDims, videoPath, trimStart, trimEnd, duration, isFullFrame, fastCut,
        replaceOriginal, exportBusy, onExport, t]);

    const handleBatchCut = useCallback(() => {
        if (!hasTemplateSelection || !videoPath) return;
        onBatchCut({ templatePath: videoPath, start: trimStart, end: trimEnd });
    }, [hasTemplateSelection, videoPath, trimStart, trimEnd, onBatchCut]);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: theme.bg }}>
            {/* Toolbar — follows the app theme like every other ReVid panel */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 12px', background: theme.bgSecondary,
                borderBottom: `1px solid ${theme.border}`
            }}>
                {PRESETS.map((p, i) => (
                    <button
                        key={p.label}
                        onClick={() => setAspectIdx(i)}
                        style={{
                            padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                            background: i === aspectIdx ? theme.accent : theme.inputBg,
                            color: i === aspectIdx ? '#fff' : theme.textSecondary,
                            transition: 'all 0.15s'
                        }}
                    >
                        {p.label}
                    </button>
                ))}
                <div style={{ flex: 1 }} />
                <button
                    title={hasTemplateSelection ? t('editorBatchCutHint') : t('editorBatchCutNeedSelection')}
                    onClick={handleBatchCut}
                    disabled={!hasTemplateSelection}
                    style={{
                        padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                        background: theme.inputBg,
                        color: hasTemplateSelection ? theme.textSecondary : theme.textTertiary,
                        opacity: hasTemplateSelection ? 1 : 0.5
                    }}
                >
                    {t('editorBatchCut')}
                </button>
                <button
                    onClick={onCancel}
                    style={{ color: theme.textTertiary, fontSize: 18, padding: '2px 8px' }}
                >
                    {'✕'}
                </button>
            </div>

            {/* Main content */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <div
                    ref={containerRef}
                    style={{ width: '100%', height: '100%', position: 'relative' }}
                >
                    <video
                        ref={videoRef}
                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                        poster={getCachedThumbnail(videoSrc) || undefined}
                        preload="auto"
                        playsInline
                    />
                    {displayRect && videoDims && crop && (
                        <CropOverlay
                            displayRect={displayRect}
                            videoDimensions={videoDims}
                            aspectRatio={aspectRatio}
                            crop={crop}
                            onCropChange={setCrop}
                            onTap={togglePlay}
                        />
                    )}
                </div>
            </div>

            {/* Timeline */}
            {duration > 0 && (
                <TrimTimeline
                    duration={duration}
                    trimStart={trimStart}
                    trimEnd={trimEnd}
                    currentTime={currentTime}
                    thumbnails={thumbnails}
                    onTrimChange={handleTrimChange}
                    onSeek={handleSeek}
                    onScrubStart={pauseVideo}
                    contentWidth={displayRect ? Math.max(Math.round(displayRect.width), 560) : undefined}
                />
            )}

            {/* Footer — transport on the left, export actions on the right */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 16px', background: theme.bgSecondary,
                borderTop: `1px solid ${theme.border}`
            }}>
                <button
                    title={t('editorPlayPause')}
                    onClick={togglePlay}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 34, height: 30, borderRadius: 6,
                        color: '#fff', background: theme.accent
                    }}
                >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                    title={t('editorPrevFrame')}
                    onClick={() => stepFrame(-1)}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 30, height: 30, borderRadius: 6,
                        color: theme.textSecondary, background: theme.inputBg
                    }}
                >
                    <StepBack size={14} />
                </button>
                <button
                    title={t('editorNextFrame')}
                    onClick={() => stepFrame(1)}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 30, height: 30, borderRadius: 6,
                        color: theme.textSecondary, background: theme.inputBg
                    }}
                >
                    <StepForward size={14} />
                </button>
                <button
                    title={t('editorToggleSound')}
                    onClick={toggleMute}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 30, height: 30, borderRadius: 6,
                        color: theme.textSecondary, background: theme.inputBg
                    }}
                >
                    {muted ? <VolumeOff size={14} /> : <VolumeOn size={14} />}
                </button>
                <span style={{
                    fontSize: 12, color: theme.textTertiary,
                    fontVariantNumeric: 'tabular-nums', marginLeft: 4
                }}>
                    {formatTimePrecise(currentTime)} / {formatTime(duration)}
                </span>
                <div style={{ flex: 1 }} />
                {isFullFrame && (
                    <label
                        title={t('editorFastCutHint')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: 12, color: theme.textSecondary, cursor: 'pointer'
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={fastCut}
                            onChange={(e) => setFastCut(e.target.checked)}
                            style={{ accentColor: theme.accent }}
                        />
                        {t('editorFastCut')}
                    </label>
                )}
                <label
                    title={t('editorReplaceHint')}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 12, cursor: 'pointer',
                        color: replaceOriginal ? theme.error : theme.textSecondary
                    }}
                >
                    <input
                        type="checkbox"
                        checked={replaceOriginal}
                        onChange={(e) => setReplaceOriginal(e.target.checked)}
                        style={{ accentColor: theme.error }}
                    />
                    {t('editorReplace')}
                </label>
                <button className="btn btn-ghost" onClick={onCancel}>{t('cancel')}</button>
                <button
                    className="btn btn-primary"
                    onClick={handleExport}
                    disabled={!crop || exportBusy}
                    title={exportBusy ? t('exportBusy') : undefined}
                >
                    {isFullFrame ? t('editorExport') : t('cropVideo')}
                </button>
            </div>
        </div>
    );
};

export default VideoEditor;
