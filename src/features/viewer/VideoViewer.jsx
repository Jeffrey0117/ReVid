import { useState, useEffect, useRef, useCallback } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';

export const VideoViewer = ({ src }) => {
    const containerRef = useRef(null);
    const plyrWrapperRef = useRef(null);
    const plyrRef = useRef(null);

    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const scaleRef = useRef(1);
    const positionRef = useRef({ x: 0, y: 0 });
    const dragStartRef = useRef({ x: 0, y: 0 });

    useEffect(() => { scaleRef.current = scale; }, [scale]);
    useEffect(() => { positionRef.current = position; }, [position]);
    useEffect(() => { dragStartRef.current = dragStart; }, [dragStart]);

    // Create Plyr imperatively (outside React render tree) to avoid DOM conflicts
    useEffect(() => {
        const wrapper = plyrWrapperRef.current;
        if (!wrapper || !src) return;

        if (plyrRef.current) {
            plyrRef.current.destroy();
            plyrRef.current = null;
        }
        wrapper.innerHTML = '';

        const video = document.createElement('video');
        video.style.width = '100%';
        wrapper.appendChild(video);

        const player = new Plyr(video, {
            controls: [
                'play-large', 'play', 'progress', 'current-time',
                'duration', 'mute', 'volume', 'fullscreen'
            ],
            tooltips: { controls: false, seek: true },
            keyboard: { focused: true, global: false }
        });

        player.source = {
            type: 'video',
            sources: [{ src, type: 'video/mp4' }]
        };

        plyrRef.current = player;

        return () => {
            player.destroy();
            plyrRef.current = null;
        };
    }, [src]);

    // Reset zoom on src change
    useEffect(() => {
        scaleRef.current = 1;
        positionRef.current = { x: 0, y: 0 };
        setScale(1);
        setPosition({ x: 0, y: 0 });
    }, [src]);

    const updateScaleAndPosition = useCallback((newScale, newPos) => {
        scaleRef.current = newScale;
        positionRef.current = newPos;
        setScale(newScale);
        setPosition(newPos);
    }, []);

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        const newScale = Math.max(0.5, Math.min(5, scaleRef.current + delta));
        if (newScale !== scaleRef.current) {
            const ratio = newScale / scaleRef.current;
            updateScaleAndPosition(newScale, {
                x: mouseX - (mouseX - positionRef.current.x) * ratio,
                y: mouseY - (mouseY - positionRef.current.y) * ratio
            });
        }
    }, [updateScaleAndPosition]);

    const handleDoubleClick = useCallback(() => {
        updateScaleAndPosition(1, { x: 0, y: 0 });
    }, [updateScaleAndPosition]);

    const handleMouseDown = useCallback((e) => {
        if (scaleRef.current <= 1) return;
        if (e.target.closest('.plyr__controls') || e.target.closest('.plyr__control')) return;
        e.preventDefault();
        setIsDragging(true);
        setDragStart({ x: e.clientX - positionRef.current.x, y: e.clientY - positionRef.current.y });
    }, []);

    const handleMouseMove = useCallback((e) => {
        setPosition({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y });
    }, []);

    const handleMouseUp = useCallback(() => setIsDragging(false), []);

    useEffect(() => {
        const c = containerRef.current;
        if (!c) return;
        c.addEventListener('wheel', handleWheel, { passive: false });
        return () => c.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    useEffect(() => {
        if (!isDragging) return;
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, handleMouseMove, handleMouseUp]);

    return (
        <div
            ref={containerRef}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', userSelect: 'none', cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default' }}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
        >
            <div style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                width: '80%', maxWidth: '1200px'
            }}>
                <div ref={plyrWrapperRef} />
            </div>
        </div>
    );
};
