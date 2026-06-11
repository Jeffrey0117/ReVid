import { useEffect, useRef, useState, useCallback } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { useI18n } from '../../i18n.jsx';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Gain multipliers for volume boost (1 = native 100%, >1 amplifies past it).
const BOOST_OPTIONS = [1, 1.5, 2, 3];

const SPEED_KEY = 'revid-viewer-speed';
const BOOST_KEY = 'revid-viewer-boost';
const readNum = (key, fallback) => {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const VideoViewer = ({ src }) => {
    const { t } = useI18n();
    const wrapperRef = useRef(null);
    const plyrRef = useRef(null);
    const videoElRef = useRef(null);

    // Web Audio graph for volume boost (HTML5 <video>.volume caps at 1.0, so
    // anything above 100% needs a GainNode). Created lazily on first boost.
    const audioCtxRef = useRef(null);
    const gainRef = useRef(null);
    const sourceRef = useRef(null);

    const [speed, setSpeed] = useState(() => readNum(SPEED_KEY, 1));
    const [boost, setBoost] = useState(() => readNum(BOOST_KEY, 1));
    const [loop, setLoop] = useState(false);
    const [menu, setMenu] = useState(null); // { x, y } | null

    // Keep the latest playback prefs in refs so the (src-only) build effect can
    // re-apply them to a freshly created <video> without re-running on each change.
    const prefsRef = useRef({ speed, boost, loop });
    prefsRef.current = { speed, boost, loop };

    // Route the current <video> through an AudioContext → GainNode → speakers.
    // A MediaElementSource is one-per-element, so this is rebuilt per source.
    const ensureGain = useCallback(() => {
        const video = videoElRef.current;
        if (!video) return null;
        if (!audioCtxRef.current) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        if (!sourceRef.current) {
            try {
                sourceRef.current = ctx.createMediaElementSource(video);
                gainRef.current = ctx.createGain();
                sourceRef.current.connect(gainRef.current).connect(ctx.destination);
            } catch {
                return gainRef.current; // already wired (or unsupported)
            }
        }
        return gainRef.current;
    }, []);

    const applyBoost = useCallback((value) => {
        setBoost(value);
        localStorage.setItem(BOOST_KEY, String(value));
        // At 100% with no graph yet, leave audio on the native path (avoids
        // routing through a gesture-suspended context and muting playback).
        if (value === 1 && !gainRef.current) return;
        const gain = ensureGain();
        if (gain) gain.gain.value = value;
    }, [ensureGain]);

    const applySpeed = useCallback((value) => {
        setSpeed(value);
        localStorage.setItem(SPEED_KEY, String(value));
        const player = plyrRef.current;
        if (player) player.speed = value;
        else if (videoElRef.current) videoElRef.current.playbackRate = value;
    }, []);

    const toggleLoop = useCallback(() => {
        setLoop((prev) => {
            const next = !prev;
            if (videoElRef.current) videoElRef.current.loop = next;
            return next;
        });
    }, []);

    const enterPip = useCallback(() => {
        const video = videoElRef.current;
        if (!video) return;
        try {
            if (document.pictureInPictureElement) document.exitPictureInPicture();
            else video.requestPictureInPicture?.();
        } catch { /* unsupported */ }
    }, []);

    // (Re)build Plyr whenever the source changes.
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper || !src) return;

        if (plyrRef.current) {
            plyrRef.current.destroy();
            plyrRef.current = null;
        }
        // Drop the previous element's audio graph (its source node is dead).
        try { sourceRef.current?.disconnect(); } catch {}
        try { gainRef.current?.disconnect(); } catch {}
        sourceRef.current = null;
        gainRef.current = null;
        wrapper.innerHTML = '';

        const video = document.createElement('video');
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        wrapper.appendChild(video);
        videoElRef.current = video;

        const player = new Plyr(video, {
            controls: [
                'play-large', 'play', 'progress', 'current-time',
                'duration', 'mute', 'volume', 'settings', 'pip', 'fullscreen'
            ],
            settings: ['speed'],
            speed: { selected: prefsRef.current.speed, options: SPEED_OPTIONS },
            tooltips: { controls: false, seek: true },
            keyboard: { focused: true, global: false },
            autoplay: true
        });

        player.source = {
            type: 'video',
            sources: [{ src, type: 'video/mp4' }]
        };

        plyrRef.current = player;

        // Re-apply the user's current preferences to the new element.
        const { speed: s, boost: b, loop: l } = prefsRef.current;
        video.loop = l;
        const reapply = () => {
            video.playbackRate = s;
            if (b !== 1) {
                const gain = ensureGain();
                if (gain) gain.gain.value = b;
            }
            // "Open and it plays": kick off playback once the video is ready.
            // Electron allows autoplay with sound; ignore the promise rejection
            // if a browser policy ever blocks it.
            const p = player.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        };
        player.on('loadedmetadata', reapply);

        return () => {
            player.off?.('loadedmetadata', reapply);
            player.destroy();
            plyrRef.current = null;
            videoElRef.current = null;
            try { sourceRef.current?.disconnect(); } catch {}
            try { gainRef.current?.disconnect(); } catch {}
            sourceRef.current = null;
            gainRef.current = null;
        };
    }, [src, ensureGain]);

    // Close the AudioContext when the viewer unmounts entirely.
    useEffect(() => () => {
        try { audioCtxRef.current?.close(); } catch {}
        audioCtxRef.current = null;
    }, []);

    // Close the context menu on outside click / Escape.
    useEffect(() => {
        if (!menu) return;
        const close = () => setMenu(null);
        const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
        // Left-click anywhere or Escape closes; a fresh right-click on the player
        // just repositions (handled by openMenu), so don't close on contextmenu.
        window.addEventListener('click', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const openMenu = useCallback((e) => {
        e.preventDefault();
        // Clamp so the menu stays on screen.
        const MENU_W = 230, MENU_H = 250;
        const x = Math.min(e.clientX, window.innerWidth - MENU_W);
        const y = Math.min(e.clientY, window.innerHeight - MENU_H);
        setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
    }, []);

    return (
        <div
            ref={wrapperRef}
            onContextMenu={openMenu}
            style={{
                width: '100%', height: '100%',
                overflow: 'hidden', background: '#000', position: 'relative'
            }}
        >
            {menu && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    style={{
                        position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999,
                        width: 214, padding: 8,
                        background: 'rgba(20,20,22,0.97)', color: '#fff',
                        border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                        boxShadow: '0 8px 28px rgba(0,0,0,0.5)', fontSize: 13,
                        backdropFilter: 'blur(6px)', userSelect: 'none'
                    }}
                >
                    <div style={menuLabel}>{t('ctxPlaybackSpeed')}</div>
                    <div style={chipRow}>
                        {SPEED_OPTIONS.map((s) => (
                            <button
                                key={s}
                                onClick={() => applySpeed(s)}
                                style={chip(speed === s)}
                            >{s}x</button>
                        ))}
                    </div>

                    <div style={menuLabel}>{t('ctxVolumeBoost')}</div>
                    <div style={chipRow}>
                        {BOOST_OPTIONS.map((b) => (
                            <button
                                key={b}
                                onClick={() => applyBoost(b)}
                                style={chip(boost === b)}
                            >{Math.round(b * 100)}%</button>
                        ))}
                    </div>

                    <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '8px 4px' }} />

                    <button onClick={() => { toggleLoop(); }} style={menuItem}>
                        <span>{t('ctxLoop')}</span>
                        <span style={{ opacity: 0.7 }}>{loop ? '✓' : ''}</span>
                    </button>
                    <button onClick={() => { enterPip(); setMenu(null); }} style={menuItem}>
                        <span>{t('ctxPictureInPicture')}</span>
                    </button>
                </div>
            )}
        </div>
    );
};

const menuLabel = {
    fontSize: 11, opacity: 0.55, textTransform: 'uppercase',
    letterSpacing: 0.5, padding: '6px 4px 4px'
};
const chipRow = { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 2px' };
const chip = (active) => ({
    flex: '1 0 auto', minWidth: 40, padding: '5px 6px', cursor: 'pointer',
    border: 'none', borderRadius: 6, fontSize: 12,
    background: active ? '#6366f1' : 'rgba(255,255,255,0.08)',
    color: active ? '#fff' : 'rgba(255,255,255,0.85)',
    fontWeight: active ? 600 : 400
});
const menuItem = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    width: '100%', padding: '8px 8px', cursor: 'pointer',
    border: 'none', borderRadius: 6, background: 'transparent',
    color: '#fff', fontSize: 13, textAlign: 'left'
};
