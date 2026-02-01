import { useState, useCallback, lazy, Suspense } from 'react';
import { VideoViewer } from './features/viewer/VideoViewer';

const VideoEditor = lazy(() => import('./features/editor/VideoEditor'));

const getElectronAPI = () => window.electronAPI || null;

export default function App() {
    const [videoSrc, setVideoSrc] = useState(null);
    const [videoPath, setVideoPath] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [toast, setToast] = useState(null);

    const handleOpen = useCallback(async () => {
        const api = getElectronAPI();
        if (!api) return;
        const filePath = await api.openVideo();
        if (!filePath) return;
        setVideoPath(filePath);
        setVideoSrc(`local-video:///${filePath.replace(/\\/g, '/')}`);
        setIsEditing(false);
    }, []);

    const handleCropComplete = useCallback(async (result) => {
        if (!result?.buffer) return;
        const api = getElectronAPI();
        if (!api) return;

        let defaultName = `cropped-${Date.now()}.mp4`;
        if (videoPath) {
            const ext = api.path.extname(videoPath);
            const base = api.path.basename(videoPath, ext);
            defaultName = `${base}-cropped.mp4`;
        }

        const { canceled, filePath } = await api.showSaveDialog(defaultName);
        if (canceled || !filePath) {
            setIsEditing(false);
            return;
        }

        const saveResult = await api.saveVideoBuffer(filePath, result.buffer);
        setIsEditing(false);

        if (saveResult.success) {
            setToast('Saved!');
        } else {
            setToast(`Failed: ${saveResult.error}`);
        }
        setTimeout(() => setToast(null), 2000);
    }, [videoPath]);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Top bar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', background: 'rgba(255,255,255,0.05)',
                borderBottom: '1px solid rgba(255,255,255,0.1)'
            }}>
                <button className="btn btn-ghost" onClick={handleOpen}>Open Video</button>
                {videoSrc && (
                    <button className="btn btn-ghost" onClick={() => setIsEditing(true)}>
                        Crop
                    </button>
                )}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                    {videoPath ? videoPath.split(/[/\\]/).pop() : 'ReVid POC'}
                </span>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {videoSrc ? (
                    <VideoViewer src={videoSrc} />
                ) : (
                    <div style={{
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(255,255,255,0.3)', fontSize: 16
                    }}>
                        Click "Open Video" to begin
                    </div>
                )}
            </div>

            {/* Editor overlay */}
            {isEditing && videoSrc && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000' }}>
                    <Suspense fallback={
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.5)' }}>
                            Loading editor...
                        </div>
                    }>
                        <VideoEditor
                            videoSrc={videoSrc}
                            onCancel={() => setIsEditing(false)}
                            onComplete={handleCropComplete}
                        />
                    </Suspense>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                    padding: '8px 20px', borderRadius: 8, background: 'rgba(0,0,0,0.85)',
                    color: '#fff', fontSize: 14, zIndex: 999
                }}>
                    {toast}
                </div>
            )}
        </div>
    );
}
