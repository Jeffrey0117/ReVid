import { useEffect, useRef } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';

export const VideoViewer = ({ src }) => {
    const wrapperRef = useRef(null);
    const plyrRef = useRef(null);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper || !src) return;

        if (plyrRef.current) {
            plyrRef.current.destroy();
            plyrRef.current = null;
        }
        wrapper.innerHTML = '';

        const video = document.createElement('video');
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
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

    return (
        <div
            ref={wrapperRef}
            style={{
                width: '100%', height: '100%',
                overflow: 'hidden', background: '#000'
            }}
        />
    );
};
