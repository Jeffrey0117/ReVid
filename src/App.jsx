import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { VideoViewer } from './features/viewer/VideoViewer';
import { VideoThumbnailGrid } from './components/VideoThumbnailGrid';
import { VideoThumbnailBar } from './components/VideoThumbnailBar';
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
import { ExportDialog } from './features/theater/ExportDialog';
import { UploadSettings } from './features/theater/UploadSettings';
import { UploadDialog } from './features/theater/UploadDialog';
import { SpeedControl } from './components/SpeedControl';
import { InfoPanel } from './components/InfoPanel';
import { validateRevidFile } from './utils/revidFile';
import { detectPlatform } from './utils/platformDetect';

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
    const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);

    const { isPinned, togglePin, pinnedCount } = usePins();

    // Theater hooks
    const theater = useWebTheater();
    const { speed: theaterSpeed, selectSpeed: selectTheaterSpeed, SPEED_PRESETS } = usePlaybackSpeed();
    const [showAddCourseDialog, setShowAddCourseDialog] = useState(false);
    const [showExportDialog, setShowExportDialog] = useState(false);
    const [showUploadSettings, setShowUploadSettings] = useState(false);
    const [showUploadDialog, setShowUploadDialog] = useState(false);
    const [theaterSidebarVisible, setTheaterSidebarVisible] = useState(true);
    const [showInfoPanel, setShowInfoPanel] = useState(false);
    const theaterVideoStateRef = useRef(null);
    const [renamingCourseId, setRenamingCourseId] = useState(null);
    const [courseContextMenu, setCourseContextMenu] = useState(null); // { courseId, x, y }

    const handleAddCourse = useCallback(({ url, title, platform }) => {
        if (!theater.selectedFolderId) return;
        const folderId = theater.selectedFolderId;
        const course = theater.addCourse(folderId, { url, title, platform });
        theater.openCourse(course.id);

        // Async thumbnail fetch for non-YouTube platforms
        if (platform !== 'youtube') {
            const api = getElectronAPI();
            if (api?.fetchThumbnail) {
                api.fetchThumbnail(url, course.id).then((result) => {
                    if (result?.success && result.thumbnailPath) {
                        theater.updateCourseThumbnail(folderId, course.id, result.thumbnailPath);
                    }
                }).catch(() => {});
            }
        }
    }, [theater.selectedFolderId, theater.addCourse, theater.openCourse, theater.updateCourseThumbnail]);

    // Save progress and close course
    const handleCloseCourse = useCallback(() => {
        const state = theaterVideoStateRef.current;
        if (state && theater.selectedFolderId && theater.activeCourseId) {
            theater.updateProgress(theater.selectedFolderId, theater.activeCourseId, {
                lastPosition: state.currentTime,
                duration: state.duration
            });
        }
        theater.closeCourse();
    }, [theater.selectedFolderId, theater.activeCourseId, theater.updateProgress, theater.closeCourse]);

    // Import .revid / JSON backup
    const handleImport = useCallback(async () => {
        const api = getElectronAPI();
        if (!api) return;

        const selectResult = await api.selectRevidFile();
        if (!selectResult?.success || !selectResult.filePaths) return;

        for (const filePath of selectResult.filePaths) {
            const readResult = await api.readRevidFile(filePath);
            if (!readResult?.success || !readResult.data) continue;

            const data = readResult.data;
            const validation = validateRevidFile(data);
            if (!validation.valid) continue;

            if (data.type === 'revid-collection') {
                const result = theater.importJsonBackup(data, 'merge');
                if (result.success) {
                    setToast(t('importSuccess'));
                    setTimeout(() => setToast(null), 2000);
                }
            } else {
                if (!theater.selectedFolderId) {
                    const folder = theater.createFolder('Imported');
                    theater.importRevidFile(data, folder.id);
                } else {
                    theater.importRevidFile(data);
                }
                setToast(t('importSuccess'));
                setTimeout(() => setToast(null), 2000);
            }
        }
    }, [theater, t]);

    // Handle .revid file opened externally (double-click / file association)
    useEffect(() => {
        const api = getElectronAPI();
        if (!api?.onOpenRevidFile) return;

        api.onOpenRevidFile(({ data }) => {
            if (!data) return;
            const validation = validateRevidFile(data);
            if (!validation.valid) return;

            setViewMode('theater');

            if (data.type === 'revid-collection') {
                theater.importJsonBackup(data, 'merge');
            } else {
                if (!theater.selectedFolderId) {
                    const folder = theater.createFolder('Imported');
                    const result = theater.importRevidFile(data, folder.id);
                    if (result?.success && result.course) {
                        theater.openCourse(result.course.id);
                    }
                } else {
                    const result = theater.importRevidFile(data);
                    if (result?.success && result.course) {
                        theater.openCourse(result.course.id);
                    }
                }
            }
        });
    }, [theater]);

    const toggleAlwaysOnTop = useCallback(async () => {
        const api = getElectronAPI();
        if (!api?.setAlwaysOnTop) return;
        const result = await api.setAlwaysOnTop(!isAlwaysOnTop);
        if (result?.success) {
            setIsAlwaysOnTop(result.alwaysOnTop);
        }
    }, [isAlwaysOnTop]);

    useEffect(() => { localStorage.setItem('revid-view-mode', viewMode); }, [viewMode]);
    useEffect(() => { localStorage.setItem('revid-sidebar-position', sidebarPosition); }, [sidebarPosition]);
    useEffect(() => { localStorage.setItem('revid-grid-size', gridSize); }, [gridSize]);

    // Theater: 3-second progress save (including paused state)
    useEffect(() => {
        if (viewMode !== 'theater' || !theater.activeCourseId || !theater.selectedFolderId) return;

        const intervalId = setInterval(() => {
            const state = theaterVideoStateRef.current;
            if (!state) return;

            theater.updateProgress(theater.selectedFolderId, theater.activeCourseId, {
                lastPosition: state.currentTime,
                duration: state.duration
            });
        }, 3000);

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
                        handleCloseCourse();
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <path d="M9 3v18" />
                </svg>
            );
        }
        return (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                flexShrink: 0, height: 52,
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                background: theme.bgTertiary,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderBottom: `1px solid ${theme.border}`
            }}>
                {/* Left: Folder + Count + View Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <button className="btn btn-ghost" onClick={handleOpenFolder}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
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
                                padding: 7, borderRadius: 8, display: 'flex',
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
                            padding: 7, borderRadius: 8, display: 'flex',
                            color: viewMode === 'theater' ? theme.accent : undefined,
                            background: viewMode === 'theater' ? theme.accentBg : undefined
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                            <path d="M2 12h20" />
                        </svg>
                    </button>

                    {/* Add URL — theater mode with folder selected (REPIC pattern) */}
                    {viewMode === 'theater' && theater.selectedFolderId && (
                        <>
                            <button
                                onClick={() => setShowAddCourseDialog(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '6px 12px', borderRadius: 8,
                                    fontSize: 12, fontWeight: 500,
                                    background: isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.15)',
                                    color: theme.accent,
                                    border: 'none', cursor: 'pointer',
                                    transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(59,130,246,0.3)' : 'rgba(91,142,201,0.25)'}
                                onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.15)'}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                                {t('addCourseUrl')}
                            </button>
                        </>
                    )}
                </div>

                {/* Center: Tools (viewer) or Sort/Filter (grid) */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    {viewMode === 'viewer' && currentVideo && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 1,
                            padding: '2px 4px', borderRadius: 12,
                            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                            color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'
                        }}>
                            {/* Crop */}
                            <button className="btn btn-ghost" onClick={() => setIsEditing(true)} title={t('cropVideo')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12" />
                                    <path d="M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" />
                                    <path d="M14.8 14.8 20 20" />
                                </svg>
                            </button>
                            {/* Screenshots */}
                            <button className="btn btn-ghost" onClick={() => setShowScreenshots(true)} title={t('screenshots')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                                    <circle cx="12" cy="13" r="3" />
                                </svg>
                            </button>
                            {/* GIF */}
                            <button className="btn btn-ghost" onClick={() => setShowGif(true)} title={t('createGif')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                                    <path d="M7 2v20" /><path d="M17 2v20" />
                                    <path d="M2 12h20" /><path d="M2 7h5" /><path d="M2 17h5" />
                                    <path d="M17 7h5" /><path d="M17 17h5" />
                                </svg>
                            </button>
                            {/* Compress */}
                            <button className="btn btn-ghost" onClick={() => setShowCompress(true)} title={t('compress')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                                    <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                                </svg>
                            </button>
                            {/* Audio */}
                            <button className="btn btn-ghost" onClick={() => setShowAudio(true)} title={t('extractAudio')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 18V5l12-2v13" />
                                    <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                </svg>
                            </button>
                            {/* Speed */}
                            <button className="btn btn-ghost" onClick={() => setShowSpeed(true)} title={t('speedOutput')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m12 14 4-4" />
                                    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                                </svg>
                            </button>

                            <div style={{ width: 1, height: 20, margin: '0 3px', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />

                            {/* Batch Crop */}
                            <button className="btn btn-ghost" onClick={() => setShowBatchCrop(true)} title={t('batchCrop')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" />
                                </svg>
                            </button>
                            {/* Rename */}
                            <button className="btn btn-ghost" onClick={() => setShowBatchRename(true)} title={t('batchRename')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" />
                                    <line x1="12" y1="4" x2="12" y2="20" />
                                </svg>
                            </button>
                            {/* Concat */}
                            <button className="btn btn-ghost" onClick={() => setShowConcat(true)} title={t('concatVideos')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m8 6 4-4 4 4" /><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22" />
                                    <path d="m20 22-5-5" />
                                </svg>
                            </button>

                            <div style={{ width: 1, height: 20, margin: '0 3px', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />

                            {/* Export / Upload */}
                            <button className="btn btn-ghost" onClick={() => setShowUploadDialog(true)} title={t('export')} style={{ padding: 6, borderRadius: 8, display: 'flex' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="17 8 12 3 7 8" />
                                    <line x1="12" y1="3" x2="12" y2="15" />
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
                                    <option key={opt.value} value={opt.value}>
                                        {t(`sort${opt.value.charAt(0).toUpperCase()}${opt.value.slice(1)}`)}
                                    </option>
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
                                style={{ padding: '4px 8px', fontSize: 10, letterSpacing: 1 }}
                            >
                                {gridSize === 'small' ? t('gridSmall') : gridSize === 'medium' ? t('gridMedium') : t('gridLarge')}
                            </button>

                            {/* Export / Upload button */}
                            <button
                                onClick={() => setShowUploadDialog(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    padding: '4px 10px', borderRadius: 6,
                                    fontSize: 11, fontWeight: 500,
                                    background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(91,142,201,0.12)',
                                    color: theme.accent,
                                    border: 'none', cursor: 'pointer',
                                    transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(59,130,246,0.25)' : 'rgba(91,142,201,0.2)'}
                                onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(59,130,246,0.15)' : 'rgba(91,142,201,0.12)'}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="17 8 12 3 7 8" />
                                    <line x1="12" y1="3" x2="12" y2="15" />
                                </svg>
                                {t('export')}
                            </button>
                        </div>
                    )}
                </div>

                {/* Right: Actions (REPIC h-9 w-9 pattern) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {/* Pin / Always on Top */}
                    <button
                        onClick={toggleAlwaysOnTop}
                        title={isAlwaysOnTop ? t('unpinWindow') : t('pinWindow')}
                        style={{
                            width: 36, height: 36, padding: 0, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 'none', cursor: 'pointer',
                            transition: 'background 0.15s',
                            background: isAlwaysOnTop
                                ? (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)')
                                : 'transparent',
                            color: isAlwaysOnTop
                                ? (isDark ? '#fff' : '#1f2937')
                                : (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)')
                        }}
                        onMouseEnter={e => { if (!isAlwaysOnTop) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; }}
                        onMouseLeave={e => { if (!isAlwaysOnTop) e.currentTarget.style.background = 'transparent'; }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 17v5" />
                            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                        </svg>
                    </button>

                    {/* Info Panel Toggle */}
                    <button
                        onClick={() => setShowInfoPanel(prev => !prev)}
                        title={t('toggleInfo')}
                        style={{
                            width: 36, height: 36, padding: 0, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 'none', cursor: 'pointer',
                            transition: 'background 0.15s',
                            background: showInfoPanel
                                ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.15)')
                                : 'transparent',
                            color: showInfoPanel
                                ? theme.accent
                                : (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)')
                        }}
                        onMouseEnter={e => { if (!showInfoPanel) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; }}
                        onMouseLeave={e => { if (!showInfoPanel) e.currentTarget.style.background = 'transparent'; }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 16v-4" /><path d="M12 8h.01" />
                        </svg>
                    </button>

                    {/* Sidebar toggle — viewer: position, theater: visibility */}
                    {((viewMode === 'viewer' && files.length > 0) || viewMode === 'theater') && (
                        <button
                            onClick={viewMode === 'theater'
                                ? () => setTheaterSidebarVisible(prev => !prev)
                                : toggleSidebarPosition}
                            title={viewMode === 'theater' ? t('courseFolder') : sidebarTitle}
                            style={{
                                width: 36, height: 36, padding: 0, borderRadius: 8,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: 'none', cursor: 'pointer',
                                transition: 'background 0.15s',
                                background: (viewMode === 'theater' && theaterSidebarVisible)
                                    ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.15)')
                                    : 'transparent',
                                color: (viewMode === 'theater' && theaterSidebarVisible)
                                    ? theme.accent
                                    : (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)')
                            }}
                            onMouseEnter={e => {
                                if (!(viewMode === 'theater' && theaterSidebarVisible))
                                    e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
                            }}
                            onMouseLeave={e => {
                                if (!(viewMode === 'theater' && theaterSidebarVisible))
                                    e.currentTarget.style.background = 'transparent';
                            }}
                        >
                            {viewMode === 'theater' ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect width="18" height="18" x="3" y="3" rx="2" />
                                    <path d="M9 3v18" />
                                </svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {sidebarPosition === 'left' ? (
                                        <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 15h18" /></>
                                    ) : (
                                        <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>
                                    )}
                                </svg>
                            )}
                        </button>
                    )}

                    <div style={{ width: 1, height: 24, margin: '0 2px', background: theme.borderSecondary }} />

                    {/* Settings dropdown */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowSettingsMenu(prev => !prev)}
                            title={t('settings')}
                            style={{
                                width: 36, height: 36, padding: 0, borderRadius: 8,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: 'none', cursor: 'pointer',
                                transition: 'background 0.15s',
                                background: showSettingsMenu
                                    ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.15)')
                                    : 'transparent',
                                color: showSettingsMenu
                                    ? theme.accent
                                    : (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)')
                            }}
                            onMouseEnter={e => { if (!showSettingsMenu) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; }}
                            onMouseLeave={e => { if (!showSettingsMenu) e.currentTarget.style.background = 'transparent'; }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        </button>
                        {showSettingsMenu && createPortal(
                            <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={() => setShowSettingsMenu(false)} />
                                <div
                                    onClick={e => e.stopPropagation()}
                                    style={{
                                        position: 'fixed', right: 12, top: 52, zIndex: 10000,
                                        width: 200, padding: '4px 0', borderRadius: 12,
                                        border: `1px solid ${theme.borderSecondary}`,
                                        background: theme.dialogBg,
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                                    }}
                                >
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
                                    {/* Upload settings - only in local video mode */}
                                    {viewMode !== 'theater' && (
                                        <button
                                            onClick={() => { setShowUploadSettings(true); setShowSettingsMenu(false); }}
                                            style={{
                                                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                                padding: '8px 12px', fontSize: 13, color: theme.textSecondary,
                                                transition: 'background 0.1s'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                <polyline points="17 8 12 3 7 8" />
                                                <line x1="12" y1="3" x2="12" y2="15" />
                                            </svg>
                                            <span>{t('uploadSettings')}</span>
                                        </button>
                                    )}
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
                            </>,
                            document.body
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Inner container: flex direction changes based on sidebar position */}
                <div style={{
                    flex: 1, overflow: 'hidden', display: 'flex',
                    flexDirection: viewMode === 'viewer' && sidebarPosition === 'bottom' ? 'column' : 'row'
                }}>
                    {/* Video Thumbnail Bar - LEFT position only */}
                    {viewMode === 'viewer' && sidebarPosition === 'left' && files.length > 0 && (
                        <VideoThumbnailBar
                            files={files}
                            currentIndex={currentIndex}
                            onSelect={selectVideo}
                            position="left"
                        />
                    )}

                    {/* Theater Sidebar */}
                    {viewMode === 'theater' && (
                        <TheaterSidebar
                            folders={theater.folders}
                            selectedFolderId={theater.selectedFolderId}
                            onSelectFolder={theater.selectFolder}
                            onCreateFolder={theater.createFolder}
                            onRenameFolder={theater.renameFolder}
                            onDeleteFolder={theater.deleteFolder}
                            onExport={() => setShowExportDialog(true)}
                            onImport={handleImport}
                            isVisible={theaterSidebarVisible}
                        />
                    )}

                    {/* Inner row: Main + InfoPanel */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
                    {/* Main Viewport */}
                    <main style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                        {viewMode === 'theater' ? (
                            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                                {/* Theater top bar: speed control + title */}
                                {theater.activeCourse && (
                                    <div style={{
                                        flexShrink: 0, height: 40,
                                        display: 'flex', alignItems: 'center',
                                        padding: '0 12px', gap: 12,
                                        background: theme.bgTertiary,
                                        borderBottom: `1px solid ${theme.border}`
                                    }}>
                                        <SpeedControl
                                            speed={theaterSpeed}
                                            presets={SPEED_PRESETS}
                                            onSelect={selectTheaterSpeed}
                                            compact
                                        />
                                        <span style={{ fontSize: 12, color: theme.textTertiary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {theater.activeCourse.url}
                                        </span>
                                        <button
                                            className="btn btn-ghost"
                                            onClick={handleCloseCourse}
                                            style={{ padding: 4, fontSize: 12 }}
                                            title={t('close')}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                )}

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
                                            startAt={theater.activeCourse.progress?.lastPosition || 0}
                                            onVideoDetected={(info) => {
                                                theater.updateProgress(theater.selectedFolderId, theater.activeCourseId, {
                                                    duration: info.duration
                                                });
                                            }}
                                            onVideoState={(state) => {
                                                theaterVideoStateRef.current = state;
                                            }}
                                            onThumbnailCaptured={(thumbnail) => {
                                                if (!theater.activeCourse?.thumbnail) {
                                                    theater.updateCourseThumbnail(theater.selectedFolderId, theater.activeCourseId, thumbnail);
                                                }
                                            }}
                                            onPlaybackRateChange={selectTheaterSpeed}
                                            playlist={theater.activeCourses}
                                            currentCourseId={theater.activeCourseId}
                                            onPlaylistSelect={(courseId) => theater.openCourse(courseId)}
                                            className="flex-1 min-h-0"
                                        />
                                    )
                                ) : theater.selectedFolder && theater.activeCourses.length > 0 ? (
                                    /* Course thumbnail grid */
                                    <div style={{
                                        width: '100%', height: '100%',
                                        overflowY: 'auto', padding: 16,
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                        gap: 12, alignContent: 'start'
                                    }}>
                                        {theater.activeCourses.map(course => {
                                            const progress = course.progress?.duration > 0
                                                ? Math.round((course.progress.lastPosition / course.progress.duration) * 100)
                                                : 0;
                                            const isRenaming = renamingCourseId === course.id;
                                            return (
                                                <div
                                                    key={course.id}
                                                    onClick={() => !isRenaming && theater.openCourse(course.id)}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        setCourseContextMenu({ courseId: course.id, x: e.clientX, y: e.clientY });
                                                    }}
                                                    style={{
                                                        cursor: 'pointer', borderRadius: 8,
                                                        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                                                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                                                        overflow: 'hidden',
                                                        transition: 'transform 0.15s, box-shadow 0.15s'
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.transform = 'translateY(0)';
                                                        e.currentTarget.style.boxShadow = 'none';
                                                    }}
                                                >
                                                    {/* Thumbnail */}
                                                    <div style={{
                                                        width: '100%', aspectRatio: '16/9',
                                                        background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        position: 'relative'
                                                    }}>
                                                        {course.thumbnail ? (
                                                            <img
                                                                src={course.thumbnail}
                                                                alt=""
                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                            />
                                                        ) : (
                                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'} strokeWidth="1.5">
                                                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                                            </svg>
                                                        )}
                                                        {/* Progress bar overlay */}
                                                        {progress > 0 && (
                                                            <div style={{
                                                                position: 'absolute', bottom: 0, left: 0, right: 0,
                                                                height: 3, background: 'rgba(0,0,0,0.3)'
                                                            }}>
                                                                <div style={{
                                                                    height: '100%', background: theme.accent,
                                                                    width: `${Math.min(100, progress)}%`
                                                                }} />
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Title */}
                                                    <div style={{ padding: '8px 10px' }}>
                                                        {isRenaming ? (
                                                            <input
                                                                autoFocus
                                                                defaultValue={course.title}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onBlur={(e) => {
                                                                    const newTitle = e.target.value.trim();
                                                                    if (newTitle && newTitle !== course.title) {
                                                                        theater.renameCourse(theater.selectedFolderId, course.id, newTitle);
                                                                    }
                                                                    setRenamingCourseId(null);
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        e.target.blur();
                                                                    } else if (e.key === 'Escape') {
                                                                        setRenamingCourseId(null);
                                                                    }
                                                                }}
                                                                style={{
                                                                    width: '100%', padding: '2px 4px',
                                                                    fontSize: 13, fontWeight: 500,
                                                                    background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                                                                    border: `1px solid ${theme.accent}`,
                                                                    borderRadius: 4, outline: 'none',
                                                                    color: isDark ? '#fff' : '#1f2937',
                                                                }}
                                                            />
                                                        ) : (
                                                            <p
                                                                onDoubleClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setRenamingCourseId(course.id);
                                                                }}
                                                                style={{
                                                                    fontSize: 13, fontWeight: 500,
                                                                    color: isDark ? '#fff' : '#1f2937',
                                                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                                                    whiteSpace: 'nowrap'
                                                                }}
                                                            >
                                                                {course.title}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : theater.selectedFolder ? (
                                    /* Empty folder - show input to add URLs */
                                    <div style={{
                                        width: '100%', height: '100%',
                                        display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center',
                                        padding: 32
                                    }}>
                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: theme.textTertiary, marginBottom: 16 }}>
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                        </svg>
                                        <p style={{ fontSize: 16, color: theme.textTertiary, marginBottom: 8 }}>
                                            {t('emptyAlbum')}
                                        </p>
                                        <p style={{ fontSize: 13, color: theme.textTertiary, marginBottom: 16 }}>
                                            {t('emptyAlbumHint')}
                                        </p>
                                        <input
                                            type="text"
                                            placeholder={t('pasteVideoUrl')}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && e.target.value.trim()) {
                                                    const url = e.target.value.trim();
                                                    const detected = detectPlatform(url);
                                                    handleAddCourse({ url, title: url, platform: detected.id });
                                                    e.target.value = '';
                                                }
                                            }}
                                            style={{
                                                width: '100%', maxWidth: 400, padding: '12px 16px',
                                                fontSize: 14, borderRadius: 10,
                                                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                                border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                                                color: isDark ? '#fff' : '#1f2937',
                                                outline: 'none', transition: 'border-color 0.15s'
                                            }}
                                            onFocus={e => e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)'}
                                            onBlur={e => e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                                        />
                                        <p style={{ fontSize: 12, marginTop: 8, color: theme.textTertiary }}>
                                            {t('pasteOrEnter')}
                                        </p>
                                    </div>
                                ) : (
                                    /* No folder selected */
                                    <div style={{
                                        width: '100%', height: '100%',
                                        display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center'
                                    }}>
                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: theme.textTertiary, marginBottom: 16 }}>
                                            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                                        </svg>
                                        <p style={{ fontSize: 16, color: theme.textTertiary, marginBottom: 8 }}>
                                            {t('selectOrCreateAlbum')}
                                        </p>
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

                    {/* Info Panel */}
                    <InfoPanel
                        isVisible={showInfoPanel}
                        mode={viewMode === 'theater' ? 'theater' : 'local'}
                        metadata={
                            viewMode === 'theater' && theater.activeCourse
                                ? {
                                    title: theater.activeCourse.title,
                                    url: theater.activeCourse.url,
                                    platform: theater.activeCourse.platform,
                                    progress: theater.activeCourse.progress,
                                }
                                : currentVideo
                                    ? {
                                        filePath: currentVideo,
                                        duration: getCachedMetadata(videoSrc)?.duration || 0,
                                        index: currentIndex,
                                        total: files.length,
                                    }
                                    : null
                        }
                    />
                    </div>

                    {/* Video Thumbnail Bar - BOTTOM position only */}
                    {viewMode === 'viewer' && sidebarPosition === 'bottom' && files.length > 0 && (
                        <VideoThumbnailBar
                            files={files}
                            currentIndex={currentIndex}
                            onSelect={selectVideo}
                            position="bottom"
                        />
                    )}
                </div>

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

            {/* Export dialog (theater) */}
            <ExportDialog
                isOpen={showExportDialog}
                onClose={() => setShowExportDialog(false)}
                activeCourse={theater.activeCourse}
                selectedFolder={theater.selectedFolder}
                folders={theater.folders}
            />

            {/* Upload settings */}
            <UploadSettings
                isOpen={showUploadSettings}
                onClose={() => setShowUploadSettings(false)}
            />

            {/* Upload dialog */}
            <UploadDialog
                isOpen={showUploadDialog}
                onClose={() => setShowUploadDialog(false)}
                selectedFolderId={theater.selectedFolderId}
                onAddCourse={handleAddCourse}
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

            {/* Course context menu */}
            {courseContextMenu && (
                <>
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 998 }}
                        onClick={() => setCourseContextMenu(null)}
                    />
                    <div style={{
                        position: 'fixed',
                        left: courseContextMenu.x,
                        top: courseContextMenu.y,
                        zIndex: 999,
                        minWidth: 140, padding: '4px 0',
                        borderRadius: 8,
                        background: theme.dialogBg,
                        border: `1px solid ${theme.borderSecondary}`,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
                    }}>
                        <button
                            onClick={() => {
                                setRenamingCourseId(courseContextMenu.courseId);
                                setCourseContextMenu(null);
                            }}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 12px', fontSize: 13,
                                color: theme.textSecondary, background: 'transparent',
                                border: 'none', cursor: 'pointer', textAlign: 'left'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            </svg>
                            {t('rename')}
                        </button>
                        <button
                            onClick={() => {
                                theater.removeCourse(theater.selectedFolderId, courseContextMenu.courseId);
                                setCourseContextMenu(null);
                            }}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 12px', fontSize: 13,
                                color: '#ef4444', background: 'transparent',
                                border: 'none', cursor: 'pointer', textAlign: 'left'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                            {t('delete')}
                        </button>
                    </div>
                </>
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
