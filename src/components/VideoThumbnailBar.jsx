import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { generateVideoThumbnail, getCachedThumbnail } from '../utils/videoThumbnails';

const getElectronAPI = () => window.electronAPI || null;

const SIDEBAR_WIDTH_KEY = 'revid-sidebar-width';
const FILMSTRIP_HEIGHT_KEY = 'revid-filmstrip-height';
const MIN_WIDTH = 80;
const MAX_WIDTH = 240;
const DEFAULT_WIDTH = 140;
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 200;
const DEFAULT_HEIGHT = 100;

export const VideoThumbnailBar = ({
    files,
    currentIndex,
    onSelect,
    position = 'left', // 'left' or 'bottom'
    style = {}
}) => {
    const isHorizontal = position === 'bottom';
    const scrollContainerRef = useRef(null);

    // Separate width (for left) and height (for bottom)
    const [width, setWidth] = useState(() => {
        const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
        if (saved) {
            const parsed = parseInt(saved, 10);
            if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) return parsed;
        }
        return DEFAULT_WIDTH;
    });

    const [height, setHeight] = useState(() => {
        const saved = localStorage.getItem(FILMSTRIP_HEIGHT_KEY);
        if (saved) {
            const parsed = parseInt(saved, 10);
            if (!isNaN(parsed) && parsed >= MIN_HEIGHT && parsed <= MAX_HEIGHT) return parsed;
        }
        return DEFAULT_HEIGHT;
    });

    const [isResizing, setIsResizing] = useState(false);
    const widthRef = useRef(width);
    const heightRef = useRef(height);

    useEffect(() => { widthRef.current = width; }, [width]);
    useEffect(() => { heightRef.current = height; }, [height]);

    // Thumbnails
    const [thumbnails, setThumbnails] = useState({});
    const generatingRef = useRef(new Set());
    const failedRef = useRef(new Set());

    // Calculate thumb dimensions based on position
    const thumbSize = useMemo(() => {
        if (isHorizontal) {
            const h = height - 32;
            return { width: Math.round(h * 16 / 9), height: h };
        } else {
            const w = width - 24;
            return { width: w, height: Math.round(w * 9 / 16) };
        }
    }, [isHorizontal, width, height]);

    // Virtual scroll for vertical mode
    const [scrollPosition, setScrollPosition] = useState(0);
    const [containerSize, setContainerSize] = useState(0);
    const ITEM_GAP = 12;
    const ITEM_HEIGHT = thumbSize.height + 32 + ITEM_GAP;
    const OVERSCAN = 3;

    const visibleRange = useMemo(() => {
        if (isHorizontal) return { startIndex: 0, endIndex: files.length - 1 };
        const startIndex = Math.max(0, Math.floor(scrollPosition / ITEM_HEIGHT) - OVERSCAN);
        const visibleCount = Math.ceil(containerSize / ITEM_HEIGHT) + OVERSCAN * 2;
        const endIndex = Math.min(files.length - 1, startIndex + visibleCount);
        return { startIndex, endIndex };
    }, [isHorizontal, scrollPosition, containerSize, ITEM_HEIGHT, files.length]);

    const totalSize = files.length * ITEM_HEIGHT;

    const handleScroll = useCallback((e) => {
        if (!isHorizontal) {
            setScrollPosition(e.target.scrollTop);
        }
    }, [isHorizontal]);

    // Container size tracking for virtual scroll
    useEffect(() => {
        if (isHorizontal) return;
        const container = scrollContainerRef.current;
        if (!container) return;
        const updateSize = () => setContainerSize(container.clientHeight);
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(container);
        return () => observer.disconnect();
    }, [isHorizontal]);

    // Reset thumbnails when files change
    useEffect(() => {
        setThumbnails({});
        generatingRef.current.clear();
        failedRef.current.clear();
    }, [files]);

    // Generate thumbnails with priority
    useEffect(() => {
        if (files.length === 0) return;
        let cancelled = false;

        const generatePrioritized = async () => {
            const priorityFiles = [];
            for (let i = 0; i <= 10; i++) {
                if (currentIndex + i < files.length) priorityFiles.push(files[currentIndex + i]);
                if (i > 0 && currentIndex - i >= 0) priorityFiles.push(files[currentIndex - i]);
            }
            const remaining = files.filter(f => !priorityFiles.includes(f));
            const allFiles = [...priorityFiles, ...remaining];

            for (const file of allFiles) {
                if (cancelled) break;
                if (generatingRef.current.has(file) || failedRef.current.has(file)) continue;

                generatingRef.current.add(file);

                const videoUrl = `local-video:///${file.replace(/\\/g, '/')}`;
                const cached = getCachedThumbnail(videoUrl);
                if (cached) {
                    if (!cancelled) {
                        setThumbnails(prev => prev[file] ? prev : { ...prev, [file]: cached });
                    }
                    generatingRef.current.delete(file);
                    continue;
                }

                const thumb = await generateVideoThumbnail(videoUrl);
                generatingRef.current.delete(file);
                if (cancelled) break;

                if (thumb) {
                    setThumbnails(prev => ({ ...prev, [file]: thumb }));
                } else {
                    failedRef.current.add(file);
                }
            }
        };

        generatePrioritized();
        return () => { cancelled = true; };
    }, [files, currentIndex]);

    // Auto-scroll to current item
    const prevFilesRef = useRef(files);
    const prevPositionRef = useRef(position);
    const isInitialMount = useRef(true);

    useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || currentIndex < 0 || files.length === 0) return;

        const albumChanged = prevFilesRef.current !== files;
        const positionChanged = prevPositionRef.current !== position;
        prevFilesRef.current = files;
        prevPositionRef.current = position;

        const shouldInstant = isInitialMount.current || albumChanged || positionChanged;
        if (isInitialMount.current) isInitialMount.current = false;

        if (isHorizontal) {
            const itemWidth = thumbSize.width + ITEM_GAP;
            const scrollPos = currentIndex * itemWidth;
            if (shouldInstant) {
                container.scrollLeft = Math.max(0, scrollPos - container.clientWidth / 2 + itemWidth / 2);
            } else {
                setTimeout(() => {
                    container.scrollTo({
                        left: Math.max(0, scrollPos - container.clientWidth / 2 + itemWidth / 2),
                        behavior: 'smooth'
                    });
                }, 50);
            }
        } else {
            const scrollPos = currentIndex * ITEM_HEIGHT;
            if (shouldInstant) {
                container.scrollTop = Math.max(0, scrollPos - container.clientHeight / 2 + ITEM_HEIGHT / 2);
            } else {
                setTimeout(() => {
                    container.scrollTo({
                        top: Math.max(0, scrollPos - container.clientHeight / 2 + ITEM_HEIGHT / 2),
                        behavior: 'smooth'
                    });
                }, 50);
            }
        }
    }, [currentIndex, isHorizontal, thumbSize.width, ITEM_HEIGHT, files, position]);

    // Resize handle
    const handleResizeMouseDown = useCallback((e) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e) => {
            if (isHorizontal) {
                const windowH = window.innerHeight;
                const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, windowH - e.clientY));
                setHeight(newHeight);
            } else {
                const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
                setWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            if (isHorizontal) {
                localStorage.setItem(FILMSTRIP_HEIGHT_KEY, heightRef.current.toString());
            } else {
                localStorage.setItem(SIDEBAR_WIDTH_KEY, widthRef.current.toString());
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, isHorizontal]);

    const getFileName = useCallback((filePath) => {
        const electronAPI = getElectronAPI();
        if (electronAPI?.path?.basename) return electronAPI.path.basename(filePath);
        return filePath.split(/[\\/]/).pop() || filePath;
    }, []);

    // Container styles based on position
    const containerStyle = isHorizontal ? {
        height, flexShrink: 0, width: '100%',
        background: 'rgba(255,255,255,0.03)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden'
    } : {
        width, flexShrink: 0, height: '100%',
        background: 'rgba(255,255,255,0.03)',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden'
    };

    // Resize handle styles
    const resizeHandleStyle = isHorizontal ? {
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: 4,
        cursor: 'row-resize', zIndex: 50,
        background: isResizing ? '#3b82f6' : 'transparent',
        transition: 'background 0.15s'
    } : {
        position: 'absolute', top: 0, right: 0,
        width: 4, height: '100%',
        cursor: 'col-resize', zIndex: 50,
        background: isResizing ? '#3b82f6' : 'transparent',
        transition: 'background 0.15s'
    };

    // Scroll container styles
    const scrollStyle = isHorizontal ? {
        flex: 1, display: 'flex', alignItems: 'center',
        gap: ITEM_GAP, padding: '8px 12px',
        overflowX: 'auto', overflowY: 'hidden',
        scrollbarWidth: 'none', userSelect: 'none'
    } : {
        flex: 1, position: 'relative',
        overflowY: 'auto', overflowX: 'hidden',
        userSelect: 'none', scrollbarWidth: 'none'
    };

    const renderThumbnail = (file, index) => {
        const isActive = index === currentIndex;
        const thumb = thumbnails[file];
        const fileName = getFileName(file);

        if (isHorizontal) {
            return (
                <div
                    key={file}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(index)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(index); }}
                    style={{
                        flexShrink: 0, cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        transition: 'transform 0.1s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = ''}
                >
                    <div style={{
                        width: thumbSize.width, height: thumbSize.height,
                        borderRadius: 6, overflow: 'hidden',
                        border: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                        background: 'rgba(0,0,0,0.5)',
                        position: 'relative', transition: 'border-color 0.2s'
                    }}>
                        {thumb ? (
                            <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} draggable={false} />
                        ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
                                <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'rgba(255,255,255,0.8)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                            </div>
                        )}
                        <div style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: 3, fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>
                            {index + 1}
                        </div>
                    </div>
                    <div style={{ marginTop: 2, fontSize: 9, fontWeight: 500, textAlign: 'center', width: thumbSize.width, padding: '0 2px', color: isActive ? '#3b82f6' : 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fileName}
                    </div>
                </div>
            );
        } else {
            return (
                <div
                    key={file}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(index)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(index); }}
                    style={{
                        position: 'absolute',
                        top: index * ITEM_HEIGHT + 8,
                        left: 12,
                        width: thumbSize.width,
                        cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        transition: 'transform 0.1s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = ''}
                >
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textAlign: 'center', width: '100%', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {index + 1}
                    </div>
                    <div style={{
                        width: thumbSize.width, height: thumbSize.height,
                        borderRadius: 8, overflow: 'hidden',
                        border: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                        background: 'rgba(0,0,0,0.5)',
                        position: 'relative', transition: 'border-color 0.2s'
                    }}>
                        {thumb ? (
                            <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} draggable={false} />
                        ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
                                <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'rgba(255,255,255,0.8)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                            </div>
                        )}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, textAlign: 'center', width: '100%', padding: '0 4px', color: isActive ? '#3b82f6' : 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fileName}
                    </div>
                </div>
            );
        }
    };

    return (
        <div style={{ ...containerStyle, ...style }}>
            <div
                onMouseDown={handleResizeMouseDown}
                style={resizeHandleStyle}
                onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.background = 'rgba(255,255,255,0.3)'; }}
                onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.background = 'transparent'; }}
            />

            <div ref={scrollContainerRef} onScroll={handleScroll} style={scrollStyle}>
                {isHorizontal ? (
                    files.map((file, index) => renderThumbnail(file, index))
                ) : (
                    <div style={{ height: totalSize, width: '100%', position: 'relative' }}>
                        {files.slice(visibleRange.startIndex, visibleRange.endIndex + 1).map((file, i) =>
                            renderThumbnail(file, visibleRange.startIndex + i)
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
