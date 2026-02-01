import { useState, useRef, useCallback, useEffect } from 'react';
import { CropOverlay, getDefaultCrop } from './components/CropOverlay';
import { TrimTimeline } from './components/TrimTimeline';

const STEP = { EDIT: 'edit', PROCESSING: 'processing' };

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

export const VideoEditor = ({ videoSrc, videoPath, onCancel, onComplete }) => {
    const containerRef = useRef(null);
    const videoRef = useRef(null);

    const [step, setStep] = useState(STEP.EDIT);
    const [videoDims, setVideoDims] = useState(null);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [muted, setMuted] = useState(true);
    const [displayRect, setDisplayRect] = useState(null);
    const [aspectIdx, setAspectIdx] = useState(0);
    const [crop, setCrop] = useState(null);
    const [trimStart, setTrimStart] = useState(0);
    const [trimEnd, setTrimEnd] = useState(0);
    const [thumbnails, setThumbnails] = useState([]);
    const [progressPct, setProgressPct] = useState(0);
    const [stage, setStage] = useState('');
    const [error, setError] = useState(null);

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
        };

        v.addEventListener('loadedmetadata', onMeta);
        return () => v.removeEventListener('loadedmetadata', onMeta);
    }, [videoSrc, updateDisplayRect]);

    useEffect(() => {
        if (!videoSrc) return;
        let cancelled = false;
        generateThumbnails(videoSrc).then(t => { if (!cancelled) setThumbnails(t); });
        return () => { cancelled = true; };
    }, [videoSrc]);

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;

        const onTime = () => {
            setCurrentTime(v.currentTime);
            if (v.currentTime >= trimEnd) {
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
    }, [trimStart, trimEnd]);

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
        if (v.paused) v.play(); else v.pause();
    }, []);

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
        setTrimStart(start);
        setTrimEnd(end);
    }, []);

    const handleStartCrop = useCallback(async () => {
        if (!crop || !videoDims || !videoPath) return;

        const api = getElectronAPI();
        if (!api) return;

        // Show save dialog first
        const ext = api.path.extname(videoPath);
        const base = api.path.basename(videoPath, ext);
        const { canceled, filePath: outputPath } = await api.showSaveDialog(`${base}-cropped.mp4`);
        if (canceled || !outputPath) return;

        setStep(STEP.PROCESSING);
        setError(null);
        setProgressPct(0);
        setStage('Processing with ffmpeg...');

        if (videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
        }

        try {
            const pixelCrop = {
                x: Math.round(crop.x),
                y: Math.round(crop.y),
                width: Math.round(crop.width),
                height: Math.round(crop.height)
            };
            pixelCrop.width = pixelCrop.width % 2 === 0 ? pixelCrop.width : pixelCrop.width - 1;
            pixelCrop.height = pixelCrop.height % 2 === 0 ? pixelCrop.height : pixelCrop.height - 1;

            const trimRange = (trimStart > 0.05 || trimEnd < duration - 0.05)
                ? { startTime: trimStart, endTime: trimEnd }
                : null;

            const totalDuration = trimRange
                ? trimRange.endTime - trimRange.startTime
                : duration;

            const result = await api.cropVideo({
                inputPath: videoPath,
                outputPath,
                crop: pixelCrop,
                trim: trimRange,
                totalDuration
            }, (pct) => {
                setProgressPct(pct);
                if (pct > 0) setStage(`Encoding... ${pct}%`);
            });

            if (result.success) {
                onComplete({ success: true });
            } else {
                setError(result.error || 'ffmpeg failed');
            }
        } catch (err) {
            setError(err.message || String(err));
        }
    }, [crop, videoDims, videoPath, trimStart, trimEnd, duration, onComplete]);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#000' }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 12px', background: 'rgba(255,255,255,0.04)',
                borderBottom: '1px solid rgba(255,255,255,0.08)'
            }}>
                {step === STEP.EDIT && (
                    <>
                        {PRESETS.map((p, i) => (
                            <button
                                key={p.label}
                                onClick={() => setAspectIdx(i)}
                                style={{
                                    padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                                    background: i === aspectIdx ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                                    color: i === aspectIdx ? '#fff' : 'rgba(255,255,255,0.55)',
                                    transition: 'all 0.15s'
                                }}
                            >
                                {p.label}
                            </button>
                        ))}
                        <div style={{ flex: 1 }} />
                        <button onClick={toggleMute} style={{
                            padding: '4px 10px', borderRadius: 4, fontSize: 14,
                            color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)'
                        }}>
                            {muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
                        </button>
                        <button onClick={togglePlay} style={{
                            padding: '4px 12px', borderRadius: 4, fontSize: 13,
                            color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)'
                        }}>
                            {isPlaying ? '\u23F8' : '\u25B6'}
                        </button>
                    </>
                )}
                {step === STEP.PROCESSING && (
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{stage}</span>
                )}
                <div style={{ flex: step === STEP.PROCESSING ? 1 : 0 }} />
                <button
                    onClick={onCancel}
                    disabled={step === STEP.PROCESSING && !error}
                    style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, padding: '2px 8px' }}
                >
                    {'\u2715'}
                </button>
            </div>

            {/* Main content */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {step === STEP.EDIT && (
                    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
                        <video
                            ref={videoRef}
                            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                            muted
                            playsInline
                        />
                        {displayRect && videoDims && crop && (
                            <CropOverlay
                                displayRect={displayRect}
                                videoDimensions={videoDims}
                                aspectRatio={aspectRatio}
                                crop={crop}
                                onCropChange={setCrop}
                            />
                        )}
                    </div>
                )}

                {step === STEP.PROCESSING && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', height: '100%', gap: 20, color: 'rgba(255,255,255,0.8)'
                    }}>
                        {error ? (
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: 18, fontWeight: 500, color: '#f87171', marginBottom: 8 }}>
                                    Processing failed
                                </p>
                                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', maxWidth: 420 }}>
                                    {error}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: 16, fontWeight: 500 }}>
                                    {stage || 'Processing...'}
                                </div>
                                <div style={{ width: 300, background: '#1a1a1a', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%', background: '#3b82f6', borderRadius: 999,
                                        transition: 'width 0.3s', width: `${progressPct}%`
                                    }} />
                                </div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                                    {Math.round(crop?.width)}{'\u00d7'}{Math.round(crop?.height)} via ffmpeg
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Timeline */}
            {step === STEP.EDIT && duration > 0 && (
                <TrimTimeline
                    duration={duration}
                    trimStart={trimStart}
                    trimEnd={trimEnd}
                    currentTime={currentTime}
                    thumbnails={thumbnails}
                    onTrimChange={handleTrimChange}
                    onSeek={handleSeek}
                />
            )}

            {/* Footer */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                padding: '8px 16px', background: 'rgba(255,255,255,0.04)',
                borderTop: '1px solid rgba(255,255,255,0.08)'
            }}>
                {step === STEP.EDIT && (
                    <>
                        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
                        <button className="btn btn-primary" onClick={handleStartCrop} disabled={!crop}>
                            Crop Video
                        </button>
                    </>
                )}
                {step === STEP.PROCESSING && error && (
                    <button className="btn btn-ghost" onClick={() => { setError(null); setStep(STEP.EDIT); }}>
                        Back
                    </button>
                )}
            </div>
        </div>
    );
};

export default VideoEditor;
