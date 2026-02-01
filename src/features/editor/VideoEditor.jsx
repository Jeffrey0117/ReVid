import { useState, useRef, useCallback, useEffect } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { cropVideo } from './utils/videoCropPipeline';

const STEP = { CROP: 'crop', PROCESSING: 'processing' };

export const VideoEditor = ({ videoSrc, onCancel, onComplete }) => {
    const cropImgRef = useRef(null);
    const [step, setStep] = useState(STEP.CROP);
    const [capturedFrame, setCapturedFrame] = useState(null);
    const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
    const [crop, setCrop] = useState();
    const [completedCrop, setCompletedCrop] = useState(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [error, setError] = useState(null);

    // Auto-capture first frame on mount
    useEffect(() => {
        if (!videoSrc) return;
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;

        const cleanup = () => { video.onloadeddata = null; video.onseeked = null; video.onerror = null; };

        video.onloadeddata = () => { video.currentTime = 0.1; };
        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            setCapturedFrame(canvas.toDataURL('image/png'));
            setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
            cleanup();
            video.src = '';
        };
        video.onerror = cleanup;
        video.src = videoSrc;
    }, [videoSrc]);

    const handleStartCrop = useCallback(async () => {
        if (!completedCrop?.width || !completedCrop?.height) return;
        setStep(STEP.PROCESSING);
        setError(null);
        setProgress({ current: 0, total: 0 });

        try {
            const img = cropImgRef.current;
            const displayedWidth = img ? img.clientWidth : videoDimensions.width;
            const displayedHeight = img ? img.clientHeight : videoDimensions.height;
            const scaleX = videoDimensions.width / displayedWidth;
            const scaleY = videoDimensions.height / displayedHeight;

            const cropRect = {
                x: completedCrop.x * scaleX,
                y: completedCrop.y * scaleY,
                width: completedCrop.width * scaleX,
                height: completedCrop.height * scaleY
            };

            const buffer = await cropVideo(videoSrc, cropRect, (current, total) => {
                setProgress({ current, total });
            });

            onComplete({ type: 'video-crop', buffer });
        } catch (err) {
            setError(err.message);
        }
    }, [completedCrop, videoSrc, onComplete, videoDimensions]);

    const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#000' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
                    {step === STEP.CROP ? 'Select crop region' : 'Processing video...'}
                </span>
                <button onClick={onCancel} disabled={step === STEP.PROCESSING && !error} style={{ color: 'rgba(255,255,255,0.6)', fontSize: 20, padding: 4 }}>
                    ✕
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 16 }}>
                {step === STEP.CROP && (
                    capturedFrame ? (
                        <div style={{ maxWidth: '100%', maxHeight: '100%', overflow: 'auto' }}>
                            <ReactCrop crop={crop} onChange={setCrop} onComplete={setCompletedCrop}>
                                <img
                                    ref={cropImgRef}
                                    src={capturedFrame}
                                    alt="Video frame"
                                    style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 160px)', objectFit: 'contain' }}
                                />
                            </ReactCrop>
                        </div>
                    ) : (
                        <div style={{ color: 'rgba(255,255,255,0.5)' }}>Loading video frame...</div>
                    )
                )}

                {step === STEP.PROCESSING && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, color: 'rgba(255,255,255,0.8)' }}>
                        {error ? (
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: 18, fontWeight: 500, color: '#f87171', marginBottom: 8 }}>Processing failed</p>
                                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>{error}</p>
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: 18, fontWeight: 500 }}>Processing video...</div>
                                <div style={{ width: 320, background: '#27272a', borderRadius: 999, height: 12, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', background: '#3b82f6', borderRadius: 999, transition: 'width 0.2s', width: `${progressPercent}%` }} />
                                </div>
                                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
                                    {progress.current} / {progress.total} frames ({progressPercent}%)
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                {step === STEP.CROP && (
                    <>
                        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
                        <button className="btn btn-primary" onClick={handleStartCrop} disabled={!completedCrop?.width || !completedCrop?.height}>
                            Crop Video
                        </button>
                    </>
                )}
                {step === STEP.PROCESSING && error && (
                    <button className="btn btn-ghost" onClick={() => { setError(null); setStep(STEP.CROP); }}>Back</button>
                )}
            </div>
        </div>
    );
};

export default VideoEditor;
