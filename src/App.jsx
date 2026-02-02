import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { VideoViewer } from './features/viewer/VideoViewer';
import { VideoThumbnailGrid } from './components/VideoThumbnailGrid';
import { VideoSidebar } from './components/VideoSidebar';
import { VideoFilmstrip } from './components/VideoFilmstrip';
import { useVideoFileSystem } from './hooks/useVideoFileSystem';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import { useSortFilter, SORT_OPTIONS } from './hooks/useSortFilter';
import { ScreenshotDialog } from './components/ScreenshotDialog';
import { GifDialog } from './components/GifDialog';
import { BatchCropDialog } from './components/BatchCropDialog';
import { CompressDialog } from './components/CompressDialog';
import { AudioDialog } from './components/AudioDialog';
import { SpeedDialog } from './components/SpeedDialog';
import { getCachedMetadata } from './utils/videoMetadata';

const VideoEditor = lazy(() => import('./features/editor/VideoEditor'));

const getElectronAPI = () => window.electronAPI || null;

const SIDEBAR_POSITIONS = ['left', 'bottom'];

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
    const [showScreenshots, setShowScreenshots] = useState(false);
    const [showGif, setShowGif] = useState(false);
    const [showBatchCrop, setShowBatchCrop] = useState(false);
    const [showCompress, setShowCompress] = useState(false);
    const [showAudio, setShowAudio] = useState(false);
    const [showSpeed, setShowSpeed] = useState(false);
    const [showToolsMenu, setShowToolsMenu] = useState(false);
    const [toast, setToast] = useState(null);

    useEffect(() => { localStorage.setItem('revid-view-mode', viewMode); }, [viewMode]);
    useEffect(() => { localStorage.setItem('revid-sidebar-position', sidebarPosition); }, [sidebarPosition]);
    useEffect(() => { localStorage.setItem('revid-grid-size', gridSize); }, [gridSize]);

    const {
        displayFiles,
        sortBy, setSortBy,
        sortDir, toggleSortDir,
        filterExt, setFilterExt,
        availableExtensions,
        originalIndexOf,
        displayIndexOf
    } = useSortFilter(files);

    const displayCurrentIndex = useMemo(
        () => displayIndexOf(currentIndex),
        [displayIndexOf, currentIndex]
    );

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

    const handleSelectVideoFromGrid = useCallback((displayIdx) => {
        const originalIdx = originalIndexOf(displayIdx);
        if (originalIdx >= 0) {
            selectVideo(originalIdx);
            setViewMode('viewer');
        }
    }, [selectVideo, originalIndexOf]);

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

    const videoDuration = useMemo(() => {
        if (!videoSrc) return 0;
        const meta = getCachedMetadata(videoSrc);
        return meta?.duration || 0;
    }, [videoSrc]);

    const folderName = useMemo(() => {
        if (!currentPath) return '';
        const api = getElectronAPI();
        if (api?.path?.basename) return api.path.basename(currentPath);
        return currentPath.split(/[\\/]/).pop() || currentPath;
    }, [currentPath]);

    const sidebarIcon = useMemo(() => {
        if (sidebarPosition === 'left') {
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <path d="M9 3v18" />
                </svg>
            );
        }
        return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 15h18" />
            </svg>
        );
    }, [sidebarPosition]);

    const sidebarTitle = useMemo(() => {
        return sidebarPosition === 'left' ? 'Switch to Bottom' : 'Switch to Left';
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
                            : filterExt !== 'all'
                                ? `${displayFiles.length} / ${files.length} videos`
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

                {/* Sort (grid mode only) */}
                {viewMode === 'grid' && files.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            style={{
                                background: 'rgba(255,255,255,0.08)',
                                color: 'rgba(255,255,255,0.7)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 4,
                                padding: '3px 6px',
                                fontSize: 11,
                                cursor: 'pointer',
                                outline: 'none'
                            }}
                        >
                            {SORT_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        <button
                            className="btn btn-ghost"
                            onClick={toggleSortDir}
                            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                            style={{ padding: 4, fontSize: 12, lineHeight: 1 }}
                        >
                            {sortDir === 'asc' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m3 8 4-4 4 4" /><path d="M7 4v16" />
                                    <path d="M11 12h4" /><path d="M11 16h7" /><path d="M11 20h10" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m3 16 4 4 4-4" /><path d="M7 20V4" />
                                    <path d="M11 4h10" /><path d="M11 8h7" /><path d="M11 12h4" />
                                </svg>
                            )}
                        </button>
                    </div>
                )}

                {/* Filter by extension (grid mode only) */}
                {viewMode === 'grid' && availableExtensions.length > 1 && (
                    <select
                        value={filterExt}
                        onChange={(e) => setFilterExt(e.target.value)}
                        style={{
                            background: 'rgba(255,255,255,0.08)',
                            color: 'rgba(255,255,255,0.7)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 4,
                            padding: '3px 6px',
                            fontSize: 11,
                            cursor: 'pointer',
                            outline: 'none'
                        }}
                    >
                        <option value="all">All types</option>
                        {availableExtensions.map(ext => (
                            <option key={ext} value={ext}>{ext.toUpperCase()}</option>
                        ))}
                    </select>
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
                            color: '#3b82f6',
                            background: 'rgba(59,130,246,0.1)'
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

                {/* Tools dropdown (viewer mode with video) */}
                {viewMode === 'viewer' && currentVideo && (
                    <div style={{ position: 'relative' }}>
                        <button
                            className="btn btn-ghost"
                            onClick={() => setShowToolsMenu(prev => !prev)}
                            title="Tools"
                            style={{ padding: 6, display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                            </svg>
                        </button>
                        {showToolsMenu && (
                            <>
                                <div
                                    style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                                    onClick={() => setShowToolsMenu(false)}
                                />
                                <div style={{
                                    position: 'absolute', top: '100%', right: 0, zIndex: 100,
                                    marginTop: 4, background: '#1a1a1a',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 8, padding: 4,
                                    minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                                }}>
                                    {[
                                        { label: 'Screenshots', action: () => setShowScreenshots(true) },
                                        { label: 'Create GIF', action: () => setShowGif(true) },
                                        { label: 'Compress', action: () => setShowCompress(true) },
                                        { label: 'Extract Audio', action: () => setShowAudio(true) },
                                        { label: 'Speed Output', action: () => setShowSpeed(true) },
                                        { label: 'Batch Crop', action: () => setShowBatchCrop(true) },
                                    ].map(item => (
                                        <button
                                            key={item.label}
                                            onClick={() => { item.action(); setShowToolsMenu(false); }}
                                            style={{
                                                display: 'block', width: '100%', textAlign: 'left',
                                                padding: '8px 12px', borderRadius: 4,
                                                fontSize: 13, color: 'rgba(255,255,255,0.8)',
                                                transition: 'background 0.1s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
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
                                files={displayFiles}
                                currentIndex={displayCurrentIndex}
                                onSelectVideo={handleSelectVideoFromGrid}
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

            {/* Screenshot dialog */}
            {showScreenshots && currentVideo && (
                <ScreenshotDialog
                    videoPath={currentVideo}
                    videoDuration={videoDuration}
                    onClose={() => setShowScreenshots(false)}
                />
            )}

            {/* GIF dialog */}
            {showGif && currentVideo && (
                <GifDialog
                    videoPath={currentVideo}
                    videoDuration={videoDuration}
                    onClose={() => setShowGif(false)}
                />
            )}

            {/* Batch crop dialog */}
            {showBatchCrop && (
                <BatchCropDialog
                    files={files}
                    currentVideo={currentVideo}
                    onClose={() => setShowBatchCrop(false)}
                />
            )}

            {/* Compress dialog */}
            {showCompress && currentVideo && (
                <CompressDialog
                    videoPath={currentVideo}
                    videoDuration={videoDuration}
                    onClose={() => setShowCompress(false)}
                />
            )}

            {/* Audio dialog */}
            {showAudio && currentVideo && (
                <AudioDialog
                    videoPath={currentVideo}
                    videoDuration={videoDuration}
                    onClose={() => setShowAudio(false)}
                />
            )}

            {/* Speed dialog */}
            {showSpeed && currentVideo && (
                <SpeedDialog
                    videoPath={currentVideo}
                    videoDuration={videoDuration}
                    onClose={() => setShowSpeed(false)}
                />
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
