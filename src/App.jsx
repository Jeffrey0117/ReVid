import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { VideoViewer } from './features/viewer/VideoViewer';
import { VideoThumbnailGrid } from './components/VideoThumbnailGrid';
import { VideoSidebar } from './components/VideoSidebar';
import { VideoFilmstrip } from './components/VideoFilmstrip';
import { useVideoFileSystem } from './hooks/useVideoFileSystem';
import { useKeyboardNav } from './hooks/useKeyboardNav';

const VideoEditor = lazy(() => import('./features/editor/VideoEditor'));

const getElectronAPI = () => window.electronAPI || null;

const SIDEBAR_POSITIONS = ['left', 'bottom', 'hidden'];

export default function App() {
    const {
        files,
        currentIndex,
        currentVideo,
        loadFolder,
        selectVideo,
        nextVideo,
        prevVideo,
        currentPath
    } = useVideoFileSystem();

    const [viewMode, setViewMode] = useState(() =>
        localStorage.getItem('revid-view-mode') || 'grid'
    );
    const [sidebarPosition, setSidebarPosition] = useState(() => {
        const saved = localStorage.getItem('revid-sidebar-position');
        return SIDEBAR_POSITIONS.includes(saved) ? saved : 'left';
    });
    const [gridSize, setGridSize] = useState(() =>
        localStorage.getItem('revid-grid-size') || 'medium'
    );

    const [isEditing, setIsEditing] = useState(false);
    const [toast, setToast] = useState(null);

    useEffect(() => { localStorage.setItem('revid-view-mode', viewMode); }, [viewMode]);
    useEffect(() => { localStorage.setItem('revid-sidebar-position', sidebarPosition); }, [sidebarPosition]);
    useEffect(() => { localStorage.setItem('revid-grid-size', gridSize); }, [gridSize]);

    useKeyboardNav({
        onNext: nextVideo,
        onPrev: prevVideo,
        enabled: viewMode === 'viewer' && !isEditing
    });

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (isEditing) {
                    setIsEditing(false);
                } else if (viewMode === 'viewer') {
                    setViewMode('grid');
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isEditing, viewMode]);

    const handleOpenFolder = useCallback(async () => {
        const api = getElectronAPI();
        if (!api) return;
        const dir = await api.selectDirectory();
        if (dir) {
            loadFolder(dir);
            setViewMode('grid');
        }
    }, [loadFolder]);

    const handleSelectVideo = useCallback((index) => {
        selectVideo(index);
        setViewMode('viewer');
    }, [selectVideo]);

    const toggleGridSize = useCallback(() => {
        setGridSize(current => {
            const s = ['small', 'medium', 'large'];
            return s[(s.indexOf(current) + 1) % s.length];
        });
    }, []);

    const toggleSidebarPosition = useCallback(() => {
        setSidebarPosition(current => {
            const idx = SIDEBAR_POSITIONS.indexOf(current);
            return SIDEBAR_POSITIONS[(idx + 1) % SIDEBAR_POSITIONS.length];
        });
    }, []);

    const handleCropComplete = useCallback((result) => {
        setIsEditing(false);
        if (result?.success) {
            setToast('Saved!');
            setTimeout(() => setToast(null), 2000);
        }
    }, []);

    const videoSrc = useMemo(() => {
        if (!currentVideo) return null;
        return `local-video:///${currentVideo.replace(/\\/g, '/')}`;
    }, [currentVideo]);

    const folderName = useMemo(() => {
        if (!currentPath) return '';
        const api = getElectronAPI();
        if (api?.path?.basename) return api.path.basename(currentPath);
        return currentPath.split(/[\\/]/).pop() || currentPath;
    }, [currentPath]);

    // Sidebar icon changes based on position
    const sidebarIcon = useMemo(() => {
        if (sidebarPosition === 'left') {
            // Panel left icon
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <path d="M9 3v18" />
                </svg>
            );
        }
        if (sidebarPosition === 'bottom') {
            // Panel bottom icon
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <path d="M3 15h18" />
                </svg>
            );
        }
        // Hidden - show panel left with no highlight
        return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
            </svg>
        );
    }, [sidebarPosition]);

    const sidebarTitle = useMemo(() => {
        if (sidebarPosition === 'left') return 'Sidebar: Left → Bottom';
        if (sidebarPosition === 'bottom') return 'Sidebar: Bottom → Hidden';
        return 'Sidebar: Hidden → Left';
    }, [sidebarPosition]);

    return (
        <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column',
            background: '#0a0a0a', color: '#fff',
            overflow: 'hidden', userSelect: 'none'
        }}>
            {/* Toolbar */}
            <div style={{
                flexShrink: 0, height: 48,
                display: 'flex', alignItems: 'center',
                padding: '0 12px', gap: 8,
                background: 'rgba(255,255,255,0.03)',
                borderBottom: '1px solid rgba(255,255,255,0.06)'
            }}>
                <button className="btn btn-ghost" onClick={handleOpenFolder}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v1" />
                        <path d="M20 19a2 2 0 0 1-2-2V9a2 2 0 0 0-2-2h-4l-2-2H6a2 2 0 0 0-2 2" />
                    </svg>
                    <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folderName || 'Open Folder'}
                    </span>
                </button>

                {files.length > 0 && (
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                        {viewMode === 'viewer' && currentIndex >= 0
                            ? `${currentIndex + 1} / ${files.length}`
                            : `${files.length} videos`
                        }
                    </span>
                )}

                <div style={{ flex: 1 }} />

                {/* Grid/Viewer toggle */}
                {files.length > 0 && (
                    <button
                        className="btn btn-ghost"
                        onClick={() => setViewMode(prev => prev === 'grid' ? 'viewer' : 'grid')}
                        title={viewMode === 'grid' ? 'Switch to Viewer' : 'Switch to Grid'}
                        style={{
                            padding: 6,
                            color: viewMode === 'grid' ? '#3b82f6' : undefined,
                            background: viewMode === 'grid' ? 'rgba(59,130,246,0.1)' : undefined
                        }}
                    >
                        {viewMode === 'grid' ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                                <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect width="18" height="18" x="3" y="3" rx="2" />
                            </svg>
                        )}
                    </button>
                )}

                {/* Grid size (grid mode only) */}
                {viewMode === 'grid' && files.length > 0 && (
                    <button
                        className="btn btn-ghost"
                        onClick={toggleGridSize}
                        title="Toggle grid size"
                        style={{ padding: '4px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}
                    >
                        {gridSize}
                    </button>
                )}

                {/* Sidebar position toggle (viewer mode only) */}
                {viewMode === 'viewer' && files.length > 0 && (
                    <button
                        className="btn btn-ghost"
                        onClick={toggleSidebarPosition}
                        title={sidebarTitle}
                        style={{
                            padding: 6,
                            color: sidebarPosition !== 'hidden' ? '#3b82f6' : undefined,
                            background: sidebarPosition !== 'hidden' ? 'rgba(59,130,246,0.1)' : undefined
                        }}
                    >
                        {sidebarIcon}
                    </button>
                )}

                {/* Crop button (viewer mode with video) */}
                {viewMode === 'viewer' && currentVideo && (
                    <button
                        className="btn btn-ghost"
                        onClick={() => setIsEditing(true)}
                        title="Crop Video"
                        style={{ padding: 6 }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12" />
                            <path d="M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" />
                            <path d="M14.8 14.8 20 20" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>
                    {/* Left Sidebar */}
                    {viewMode === 'viewer' && sidebarPosition === 'left' && files.length > 0 && (
                        <VideoSidebar
                            files={files}
                            currentIndex={currentIndex}
                            onSelect={selectVideo}
                        />
                    )}

                    {/* Main Viewport */}
                    <main style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                        {files.length === 0 ? (
                            <div style={{
                                width: '100%', height: '100%',
                                display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center'
                            }}>
                                <div style={{
                                    width: 80, height: 80, borderRadius: 16,
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    marginBottom: 24
                                }}>
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                                        <polygon points="10 8 16 12 10 16 10 8" />
                                    </svg>
                                </div>
                                <p style={{ fontSize: 20, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>
                                    Open a folder to browse videos
                                </p>
                                <p style={{ fontSize: 14, marginTop: 8, color: 'rgba(255,255,255,0.4)' }}>
                                    Supports MP4, WebM, MOV, AVI, MKV
                                </p>
                                <button
                                    className="btn btn-ghost"
                                    onClick={handleOpenFolder}
                                    style={{ marginTop: 24, padding: '10px 24px', fontSize: 15, color: 'rgba(255,255,255,0.6)' }}
                                >
                                    Open Folder
                                </button>
                            </div>
                        ) : viewMode === 'grid' ? (
                            <VideoThumbnailGrid
                                files={files}
                                currentIndex={currentIndex}
                                onSelectVideo={handleSelectVideo}
                                size={gridSize}
                            />
                        ) : viewMode === 'viewer' && videoSrc ? (
                            <VideoViewer src={videoSrc} />
                        ) : null}
                    </main>
                </div>

                {/* Bottom Filmstrip */}
                {viewMode === 'viewer' && sidebarPosition === 'bottom' && files.length > 0 && (
                    <VideoFilmstrip
                        files={files}
                        currentIndex={currentIndex}
                        onSelect={selectVideo}
                    />
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
                            videoPath={currentVideo}
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
