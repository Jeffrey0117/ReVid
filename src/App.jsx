import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
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
import { usePins } from './hooks/usePins';
import { BatchRenameDialog } from './components/BatchRenameDialog';
import { ConcatDialog } from './components/ConcatDialog';
import { useI18n } from './i18n.jsx';
import { useTheme } from './theme.jsx';
import { useWebTheater } from './hooks/useWebTheater';
import { usePlaybackSpeed } from './hooks/usePlaybackSpeed';
import { TheaterSidebar } from './features/theater/TheaterSidebar';
import { CourseWebview } from './features/theater/CourseWebview';
import { YouTubePlayer } from './features/theater/YouTubePlayer';
import { AddCourseDialog } from './features/theater/AddCourseDialog';
import { SpeedControl } from './components/SpeedControl';

const VideoEditor = lazy(() => import('./features/editor/VideoEditor'));

const getElectronAPI = () => window.electronAPI || null;

const SIDEBAR_POSITIONS = ['left', 'bottom'];

export default function App() {
    const { t, lang, setLang } = useI18n();
    const { theme, isDark, toggleTheme } = useTheme();

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
    const [showBatchRename, setShowBatchRename] = useState(false);
    const [showConcat, setShowConcat] = useState(false);
    const [showPinnedOnly, setShowPinnedOnly] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    const [toast, setToast] = useState(null);

    const { isPinned, togglePin, pinnedCount } = usePins();

    // Theater hooks
    const theater = useWebTheater();
    const { speed: theaterSpeed, selectSpeed: selectTheaterSpeed, SPEED_PRESETS } = usePlaybackSpeed();
    const [showAddCourseDialog, setShowAddCourseDialog] = useState(false);
    const theaterVideoStateRef = useRef(null);

    const handleAddCourse = useCallback(({ url, title, platform }) => {
        if (!theater.selectedFolderId) return;
        const course = theater.addCourse(theater.selectedFolderId, { url, title, platform });
        theater.openCourse(course.id);
    }, [theater.selectedFolderId, theater.addCourse, theater.openCourse]);

    useEffect(() => { localStorage.setItem('revid-view-mode', viewMode); }, [viewMode]);
    useEffect(() => { localStorage.setItem('revid-sidebar-position', sidebarPosition); }, [sidebarPosition]);
    useEffect(() => { localStorage.setItem('revid-grid-size', gridSize); }, [gridSize]);

    // Theater: 5-second progress save
    useEffect(() => {
        if (viewMode !== 'theater' || !theater.activeCourseId || !theater.selectedFolderId) return;

        const intervalId = setInterval(() => {
            const state = theaterVideoStateRef.current;
            if (!state || state.paused) return;

            theater.updateProgress(theater.selectedFolderId, theater.activeCourseId, {
                lastPosition: state.currentTime,
                duration: state.duration
            });
        }, 5000);

        return () => clearInterval(intervalId);
    }, [viewMode, theater.activeCourseId, theater.selectedFolderId, theater.updateProgress]);

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

    const gridFiles = useMemo(
        () => showPinnedOnly ? displayFiles.filter(f => isPinned(f)) : displayFiles,
        [displayFiles, showPinnedOnly, isPinned]
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
                } else if (viewMode === 'theater') {
                    if (theater.activeCourseId) {
                        theater.closeCourse();
                    } else {
                        setViewMode('grid');
                    }
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

    const handleSelectVideoFromGrid = useCallback((gridIdx) => {
        const file = gridFiles[gridIdx];
        if (!file) return;
        const originalIdx = files.indexOf(file);
        if (originalIdx >= 0) {
            selectVideo(originalIdx);
            setViewMode('viewer');
        }
    }, [selectVideo, gridFiles, files]);

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
            setToast(t('saved'));
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <path d="M9 3v18" />
                </svg>
            );
        }
        return (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 15h18" />
            </svg>
        );
    }, [sidebarPosition]);

    const sidebarTitle = useMemo(() => {
        return sidebarPosition === 'left' ? t('switchToBottom') : t('switchToLeft');
    }, [sidebarPosition, t]);

    return (
        <div
            data-theme={isDark ? 'dark' : 'light'}
            style={{
                width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column',
                background: theme.bg, color: theme.text,
                overflow: 'hidden', userSelect: 'none'
            }}
        >
            {/* Toolbar */}
            <div style={{
                flexShrink: 0, height: 48,
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 12px',
                background: theme.bgTertiary,
                borderBottom: `1px solid ${theme.border}`
            }}>
                {/* Left: Folder + Count + View Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <button className="btn btn-ghost" onClick={handleOpenFolder}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v1" />
                            <path d="M20 19a2 2 0 0 1-2-2V9a2 2 0 0 0-2-2h-4l-2-2H6a2 2 0 0 0-2 2" />
                        </svg>
                        <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {folderName || t('openFolder')}
                        </span>
                    </button>

                    {files.length > 0 && (
                        <span style={{ fontSize: 12, color: theme.textTertiary, fontVariantNumeric: 'tabular-nums' }}>
                            {viewMode === 'viewer' && currentIndex >= 0
                                ? `${currentIndex + 1} / ${files.length}`
                                : filterExt !== 'all'
                                    ? `${displayFiles.length} / ${files.length} ${t('videos')}`
                                    : `${files.length} ${t('videos')}`
                            }
                        </span>
                    )}

                    {files.length > 0 && (
                        <button
                            className="btn btn-ghost"
                            onClick={() => setViewMode(prev => prev === 'grid' ? 'viewer' : 'grid')}
                            title={viewMode === 'grid' ? t('switchToViewer') : t('switchToGrid')}
                            style={{
                                padding: 6,
                                color: viewMode === 'grid' ? theme.accent : undefined,
                                background: viewMode === 'grid' ? theme.accentBg : undefined
                            }}
                        >
                            {viewMode === 'grid' ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                                    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                                </svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect width="18" height="18" x="3" y="3" rx="2" />
                                </svg>
                            )}
                        </button>
                    )}

                    {/* Online video mode toggle */}
                    <button
                        className="btn btn-ghost"
                        onClick={() => setViewMode(prev => prev === 'theater' ? 'grid' : 'theater')}
                        title={t('theaterMode')}
                        style={{
                            padding: 6, borderRadius: 8, display: 'flex',
                            color: viewMode === 'theater' ? theme.accent : undefined,
                            background: viewMode === 'theater' ? theme.accentBg : undefined
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polygon points="10 8 16 12 10 16 10 8" />
                        </svg>
                    </button>
                </div>

                {/* Center: Tools (viewer) or Sort/Filter (grid) */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    {viewMode === 'viewer' && currentVideo && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 1,
                            padding: '2px 4px', borderRadius: 12,
                            border: `1px solid ${theme.borderSecondary}`,
                            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
                        }}>
                            {/* Crop */}
                            <button className="btn btn-ghost" onClick={() => setIsEditing(true)} title={t('cropVideo')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12" />
                                    <path d="M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" />
                                    <path d="M14.8 14.8 20 20" />
                                </svg>
                            </button>
                            {/* Screenshots */}
                            <button className="btn btn-ghost" onClick={() => setShowScreenshots(true)} title={t('screenshots')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                                    <circle cx="12" cy="13" r="3" />
                                </svg>
                            </button>
                            {/* GIF */}
                            <button className="btn btn-ghost" onClick={() => setShowGif(true)} title={t('createGif')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                                    <path d="M7 2v20" /><path d="M17 2v20" />
                                    <path d="M2 12h20" /><path d="M2 7h5" /><path d="M2 17h5" />
                                    <path d="M17 7h5" /><path d="M17 17h5" />
                                </svg>
                            </button>
                            {/* Compress */}
                            <button className="btn btn-ghost" onClick={() => setShowCompress(true)} title={t('compress')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                                    <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                                </svg>
                            </button>
                            {/* Audio */}
                            <button className="btn btn-ghost" onClick={() => setShowAudio(true)} title={t('extractAudio')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 18V5l12-2v13" />
                                    <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                </svg>
                            </button>
                            {/* Speed */}
                            <button className="btn btn-ghost" onClick={() => setShowSpeed(true)} title={t('speedOutput')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m12 14 4-4" />
                                    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                                </svg>
                            </button>

                            <div style={{ width: 1, height: 26, margin: '0 3px', background: theme.borderSecondary }} />

                            {/* Batch Crop */}
                            <button className="btn btn-ghost" onClick={() => setShowBatchCrop(true)} title={t('batchCrop')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" />
                                </svg>
                            </button>
                            {/* Rename */}
                            <button className="btn btn-ghost" onClick={() => setShowBatchRename(true)} title={t('batchRename')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" />
                                    <line x1="12" y1="4" x2="12" y2="20" />
                                </svg>
                            </button>
                            {/* Concat */}
                            <button className="btn btn-ghost" onClick={() => setShowConcat(true)} title={t('concatVideos')} style={{ padding: 5, borderRadius: 8, display: 'flex' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m8 6 4-4 4 4" /><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22" />
                                    <path d="m20 22-5-5" />
                                </svg>
                            </button>
                        </div>
                    )}

                    {viewMode === 'grid' && files.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                style={{
                                    background: theme.inputBg,
                                    color: theme.textSecondary,
                                    border: `1px solid ${theme.borderSecondary}`,
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
                                title={sortDir === 'asc' ? t('ascending') : t('descending')}
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

                            {availableExtensions.length > 1 && (
                                <select
                                    value={filterExt}
                                    onChange={(e) => setFilterExt(e.target.value)}
                                    style={{
                                        background: theme.inputBg,
                                        color: theme.textSecondary,
                                        border: `1px solid ${theme.borderSecondary}`,
                                        borderRadius: 4,
                                        padding: '3px 6px',
                                        fontSize: 11,
                                        cursor: 'pointer',
                                        outline: 'none'
                                    }}
                                >
                                    <option value="all">{t('allTypes')}</option>
                                    {availableExtensions.map(ext => (
                                        <option key={ext} value={ext}>{ext.toUpperCase()}</option>
                                    ))}
                                </select>
                            )}

                            {pinnedCount > 0 && (
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => setShowPinnedOnly(prev => !prev)}
                                    title={showPinnedOnly ? t('showAll') : t('showPinnedOnly')}
                                    style={{
                                        padding: '4px 8px', fontSize: 11,
                                        color: showPinnedOnly ? theme.pin : undefined,
                                        background: showPinnedOnly ? (isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)') : undefined,
                                        display: 'flex', alignItems: 'center', gap: 4
                                    }}
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill={showPinnedOnly ? theme.pin : 'none'} stroke="currentColor" strokeWidth="2">
                                        <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                                    </svg>
                                    {pinnedCount}
                                </button>
                            )}

                            <button
                                className="btn btn-ghost"
                                onClick={toggleGridSize}
                                title="Toggle grid size"
                                style={{ padding: '4px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}
                            >
                                {gridSize}
                            </button>
                        </div>
                    )}
                </div>

                {/* Right: Sidebar + Settings */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {viewMode === 'viewer' && files.length > 0 && (
                        <button
                            className="btn btn-ghost"
                            onClick={toggleSidebarPosition}
                            title={sidebarTitle}
                            style={{ padding: 6, borderRadius: 8, display: 'flex' }}
                        >
                            {sidebarIcon}
                        </button>
                    )}

                    <div style={{ width: 1, height: 24, background: theme.borderSecondary }} />

                    {/* Settings dropdown */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className="btn btn-ghost"
                            onClick={() => setShowSettingsMenu(prev => !prev)}
                            title={t('settings')}
                            style={{
                                padding: 6, borderRadius: 8, display: 'flex',
                                ...(showSettingsMenu ? { color: theme.accent, background: theme.accentBg } : {})
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        </button>
                        {showSettingsMenu && (
                            <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowSettingsMenu(false)} />
                                <div style={{
                                    position: 'absolute', right: 0, top: '100%', marginTop: 8, zIndex: 100,
                                    width: 200, padding: '4px 0', borderRadius: 12,
                                    border: `1px solid ${theme.borderSecondary}`,
                                    background: theme.dialogBg,
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                                }}>
                                    <button
                                        onClick={() => { toggleTheme(); setShowSettingsMenu(false); }}
                                        style={{
                                            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '8px 12px', fontSize: 13, color: theme.textSecondary,
                                            transition: 'background 0.1s'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        {isDark ? (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" />
                                                <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
                                                <path d="M2 12h2" /><path d="M20 12h2" />
                                                <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
                                            </svg>
                                        ) : (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                                            </svg>
                                        )}
                                        <span>{isDark ? t('lightMode') : t('darkMode')}</span>
                                    </button>
                                    <button
                                        onClick={() => { setLang(lang === 'en' ? 'zh-TW' : 'en'); setShowSettingsMenu(false); }}
                                        style={{
                                            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '8px 12px', fontSize: 13, color: theme.textSecondary,
                                            transition: 'background 0.1s'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10" />
                                            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                                            <path d="M2 12h20" />
                                        </svg>
                                        <span>{t('changeLanguage')}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: theme.textTertiary }}>
                                            {lang === 'en' ? 'EN' : '中'}
                                        </span>
                                    </button>
                                    <div style={{ height: 1, margin: '4px 0', background: theme.border }} />
                                    <button
                                        onClick={() => { setShowAbout(true); setShowSettingsMenu(false); }}
                                        style={{
                                            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '8px 12px', fontSize: 13, color: theme.textSecondary,
                                            transition: 'background 0.1s'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10" />
                                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                            <path d="M12 17h.01" />
                                        </svg>
                                        <span>{t('about')}</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
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

                    {/* Theater Sidebar */}
                    {viewMode === 'theater' && (
                        <TheaterSidebar
                            folders={theater.folders}
                            selectedFolderId={theater.selectedFolderId}
                            activeCourseId={theater.activeCourseId}
                            onSelectFolder={theater.selectFolder}
                            onCreateFolder={theater.createFolder}
                            onRenameFolder={theater.renameFolder}
                            onDeleteFolder={theater.deleteFolder}
                            onOpenCourse={theater.openCourse}
                            onRemoveCourse={theater.removeCourse}
                            onAddCourse={() => setShowAddCourseDialog(true)}
                        />
                    )}

                    {/* Main Viewport */}
                    <main style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                        {viewMode === 'theater' ? (
                            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                                {theater.activeCourse ? (
                                    theater.activeCourse.platform === 'youtube' ? (
                                        <YouTubePlayer
                                            url={theater.activeCourse.url}
                                            playbackRate={theaterSpeed}
                                            startAt={theater.activeCourse.progress?.lastPosition || 0}
                                            onVideoDetected={(info) => {
                                                theater.updateProgress(theater.selectedFolderId, theater.activeCourseId, {
                                                    duration: info.duration
                                                });
                                            }}
                                            onVideoState={(state) => {
                                                theaterVideoStateRef.current = state;
                                            }}
                                            className="flex-1 min-h-0"
                                        />
                                    ) : (
                                        <CourseWebview
                                            url={theater.activeCourse.url}
                                            platform={theater.activeCourse.platform}
                                            playbackRate={theaterSpeed}
                                            onVideoDetected={(info) => {
                                                theater.updateProgress(theater.selectedFolderId, theater.activeCourseId, {
                                                    duration: info.duration
                                                });
                                            }}
                                            onVideoState={(state) => {
                                                theaterVideoStateRef.current = state;
                                            }}
                                            className="flex-1 min-h-0"
                                        />
                                    )
                                ) : (
                                    <div style={{
                                        width: '100%', height: '100%',
                                        display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center'
                                    }}>
                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: theme.textTertiary, marginBottom: 16 }}>
                                            <circle cx="12" cy="12" r="10" />
                                            <polygon points="10 8 16 12 10 16 10 8" />
                                        </svg>
                                        <p style={{ fontSize: 16, color: theme.textTertiary, marginBottom: 8 }}>
                                            {t('courseTheater')}
                                        </p>
                                        <p style={{ fontSize: 13, color: theme.textTertiary }}>
                                            {t('courseTheaterHint')}
                                        </p>
                                    </div>
                                )}

                                {/* Theater bottom bar: speed control */}
                                {theater.activeCourse && (
                                    <div style={{
                                        flexShrink: 0, height: 40,
                                        display: 'flex', alignItems: 'center',
                                        padding: '0 12px', gap: 12,
                                        background: theme.bgTertiary,
                                        borderTop: `1px solid ${theme.border}`
                                    }}>
                                        <SpeedControl
                                            speed={theaterSpeed}
                                            presets={SPEED_PRESETS}
                                            onSelect={selectTheaterSpeed}
                                            compact
                                        />
                                        <span style={{ fontSize: 12, color: theme.textTertiary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {theater.activeCourse.title}
                                        </span>
                                        <button
                                            className="btn btn-ghost"
                                            onClick={theater.closeCourse}
                                            style={{ padding: 4, fontSize: 12 }}
                                            title={t('close')}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : files.length === 0 ? (
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
                                <p style={{ fontSize: 20, fontWeight: 500, color: theme.textTertiary }}>
                                    {t('openFolderToBrowse')}
                                </p>
                                <p style={{ fontSize: 14, marginTop: 8, color: theme.textTertiary }}>
                                    {t('supportsFormats')}
                                </p>
                                <button
                                    className="btn btn-ghost"
                                    onClick={handleOpenFolder}
                                    style={{ marginTop: 24, padding: '10px 24px', fontSize: 15, color: theme.textSecondary }}
                                >
                                    {t('openFolder')}
                                </button>
                            </div>
                        ) : viewMode === 'grid' ? (
                            <VideoThumbnailGrid
                                files={gridFiles}
                                currentIndex={gridFiles.indexOf(currentVideo)}
                                onSelectVideo={handleSelectVideoFromGrid}
                                size={gridSize}
                                isPinned={isPinned}
                                onTogglePin={togglePin}
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

            {/* Batch rename dialog */}
            {showBatchRename && files.length > 0 && (
                <BatchRenameDialog
                    files={files}
                    onClose={() => setShowBatchRename(false)}
                    onComplete={() => loadFolder(currentPath)}
                />
            )}

            {/* Concat dialog */}
            {showConcat && files.length > 1 && (
                <ConcatDialog
                    files={files}
                    onClose={() => setShowConcat(false)}
                />
            )}

            {/* Add Course dialog (theater) */}
            <AddCourseDialog
                isOpen={showAddCourseDialog}
                onClose={() => setShowAddCourseDialog(false)}
                onAdd={handleAddCourse}
            />

            {/* About dialog */}
            {showAbout && (
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 200,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
                    }}
                    onClick={() => setShowAbout(false)}
                >
                    <div
                        style={{
                            maxWidth: 360, width: '100%', margin: '0 16px',
                            padding: 32, borderRadius: 16, textAlign: 'center',
                            background: theme.dialogBg,
                            border: `1px solid ${theme.borderSecondary}`,
                            boxShadow: '0 16px 48px rgba(0,0,0,0.4)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* App icon */}
                        <div style={{
                            width: 80, height: 80, margin: '0 auto 16px',
                            borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                            border: `1px solid ${theme.border}`, padding: 4, overflow: 'hidden'
                        }}>
                            <img src="/logo.png" alt="ReVid" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 14 }} />
                        </div>

                        {/* App name */}
                        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, color: theme.text }}>
                            ReVid
                        </h2>

                        {/* Version */}
                        <p style={{ fontSize: 13, marginBottom: 16, color: theme.textTertiary }}>
                            v0.1.0
                        </p>

                        {/* Description */}
                        <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 24, color: theme.textSecondary }}>
                            {t('appDescription')}
                        </p>

                        {/* GitHub link */}
                        <div style={{ marginBottom: 20 }}>
                            <a
                                href="https://github.com/Jeffrey0117/ReVid"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    fontSize: 13, color: theme.textTertiary,
                                    textDecoration: 'none', display: 'inline-flex',
                                    alignItems: 'center', gap: 6
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = theme.text}
                                onMouseLeave={e => e.currentTarget.style.color = theme.textTertiary}
                                onClick={e => e.stopPropagation()}
                            >
                                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                </svg>
                                GitHub
                            </a>
                        </div>

                        {/* Copyright */}
                        <p style={{ fontSize: 11, marginBottom: 20, color: theme.textTertiary }}>
                            © 2025 ReVid
                        </p>

                        {/* Close button */}
                        <button
                            className="btn btn-ghost"
                            onClick={() => setShowAbout(false)}
                            style={{ padding: '6px 24px', fontSize: 13 }}
                        >
                            {t('close')}
                        </button>
                    </div>
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
