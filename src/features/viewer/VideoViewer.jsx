import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { getCachedThumbnail } from '../../utils/videoThumbnails';
import { findActiveCueIndex } from '../../utils/subtitles';
import { TranscriptPanel } from './TranscriptPanel';
import { WordbookPanel } from './WordbookPanel';
import { EpisodePicker } from './EpisodePicker';
import { RIGHT_PANEL_WIDTH } from './layout';
import { retimeCues, PAD } from '../../utils/reelSegments';
import { shouldOfferNext, deadlineFrom, secondsLeft } from '../../utils/playNext';
import {
    anchorToTop, dropAnchor, clampTop, DRAG_THRESHOLD, widthPctFrom, scaleFrom
} from '../../utils/subtitlePosition';
import { SubtitleCue } from './SubtitleCue';
import { toReelStyle } from '../../utils/reelStyle';
import { hasFeature, FEATURES } from '../licensing/entitlements';
import {
    SubtitleSettings, readSubtitleStyle, writeSubtitleStyle, subtitleTextStyle,
    DEFAULT_SUBTITLE_STYLE
} from './SubtitleSettings';
import {
    WordCard, readDifficulty, writeDifficulty, readKnownWords, clearKnownWords
} from './WordLookup';
import {
    BookMarked, Captions, ListVideo, Lock, PanelRight, SkipForward
} from '../../components/icons';
import { setAudioSlot, setAudioSlotProvider, setPlayerBridge } from '../plugins/pluginRuntime';
import { PluginPanelHost } from '../plugins/PluginPanelHost';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Gain multipliers for volume boost (1 = native 100%, >1 amplifies past it).
const BOOST_OPTIONS = [1, 1.5, 2, 3];

// Volume boost persists (it's a "my speakers are quiet" preference); speed does
// NOT — each new video should start at the natural 1x.
const BOOST_KEY = 'revid-viewer-boost';
const CC_KEY = 'revid-cc-mode';
const TRANSLATE_ENGINE_KEY = 'revid-translate-engine';
const GEMINI_KEY = 'revid-gemini-key';
const GEMINI_MODEL_KEY = 'revid-gemini-model';
const AUTO_TRANSLATE_KEY = 'revid-auto-translate';

// Subtitle display modes, cycled by the CC button.
const CC_MODES = ['both', 'orig', 'zh', 'off'];

// What the player is being used for right now. Browse is a plain player:
// learning and editing affordances only appear when asked for, because a
// transcript covered in pencils and repeat buttons is noise while watching.
const VIEWER_MODES = ['browse', 'learn', 'edit'];
const VIEWER_MODE_KEY = 'revid-viewer-mode';
const TRANSCRIPT_KEY = 'revid-transcript-open';
const GLOW_KEY = 'revid-glow';
const AUTO_SUBS_KEY = 'revid-auto-subs';
const RESUME_KEY = 'revid-resume-positions';
// Where playback was a moment ago, within this run of the app.
const LIVE_POS_KEY = 'revid-live-position';
const MAX_RESUME_ENTRIES = 300;

const readNum = (key, fallback) => {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
const readBool = (key, fallback) => {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === 'on';
};

const getElectronAPI = () => window.electronAPI || null;

// --- cross-restart resume positions ---------------------------------------
function readResumeMap() {
    try { return JSON.parse(localStorage.getItem(RESUME_KEY)) || {}; } catch { return {}; }
}
function saveResumePosition(videoPath, time, duration) {
    try {
        const map = readResumeMap();
        map[videoPath] = { time, duration, at: Date.now() };
        const keys = Object.keys(map);
        if (keys.length > MAX_RESUME_ENTRIES) {
            keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
            for (const k of keys.slice(0, keys.length - MAX_RESUME_ENTRIES)) delete map[k];
        }
        localStorage.setItem(RESUME_KEY, JSON.stringify(map));
    } catch { /* storage full */ }
}

function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

export const VideoViewer = ({
    src, videoPath, timeRef, onExportStudy, onUpgrade,
    files = [], currentIndex = -1, onSelectVideo, onRightPanelWidth, seekRequest
}) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const wrapperRef = useRef(null);
    const plyrRef = useRef(null);
    const videoElRef = useRef(null);
    const glowRef = useRef(null);

    // Web Audio graph for volume boost (HTML5 <video>.volume caps at 1.0, so
    // anything above 100% needs a GainNode). Created lazily on first boost.
    const audioCtxRef = useRef(null);
    const gainRef = useRef(null);
    const sourceRef = useRef(null);
    // Insertion point audio plugins (e.g. an equalizer) route themselves into.
    const slotRef = useRef(null);

    const [speed, setSpeed] = useState(1); // always starts at 1x per video
    const [boost, setBoost] = useState(() => readNum(BOOST_KEY, 1));
    const [loop, setLoop] = useState(false);
    const [menu, setMenu] = useState(null); // { x, y } | null

    // Subtitles / transcript
    const [cues, setCues] = useState([]);
    const [activeCueIndex, setActiveCueIndex] = useState(-1);
    const [ccMode, setCcMode] = useState(() => {
        const saved = localStorage.getItem(CC_KEY);
        return CC_MODES.includes(saved) ? saved : 'both';
    });
    const [subStyle, setSubStyle] = useState(readSubtitleStyle);
    // One writer, so every way of changing the look is remembered: the panel,
    // a preset, and a drag of the box all land here.
    useEffect(() => { writeSubtitleStyle(subStyle); }, [subStyle]);
    const [styleOpen, setStyleOpen] = useState(false);
    const [translating, setTranslating] = useState(null); // { pct } | null
    const [translateError, setTranslateError] = useState(null);
    // Word lookup: { word, example, anchor } | null, and per-cue difficult marks.
    const [wordCard, setWordCard] = useState(null);
    const [difficultMarks, setDifficultMarks] = useState({});
    const [difficulty, setDifficulty] = useState(readDifficulty);
    const [knownWords, setKnownWords] = useState(readKnownWords);

    // Words retired on another machine arrive through a sync round.
    useEffect(() => {
        const refresh = () => setKnownWords(readKnownWords());
        window.addEventListener('revid-docs-updated', refresh);
        return () => window.removeEventListener('revid-docs-updated', refresh);
    }, []);
    const [viewerMode, setViewerMode] = useState(() => {
        const saved = localStorage.getItem(VIEWER_MODE_KEY);
        return VIEWER_MODES.includes(saved) ? saved : 'browse';
    });
    const learnMode = viewerMode === 'learn';
    const editMode = viewerMode === 'edit';
    const [transcriptOpen, setTranscriptOpen] = useState(() => readBool(TRANSCRIPT_KEY, false));
    const [wordbookOpen, setWordbookOpen] = useState(false);
    const [episodesOpen, setEpisodesOpen] = useState(false);
    const [controlsSlot, setControlsSlot] = useState(null);
    const [autoNext, setAutoNext] = useState(false);
    // { target, deadline } while the countdown is running.
    const [upNext, setUpNext] = useState(null);
    // Re-render while it runs; the deadline is what actually decides.
    const [, tickCountdown] = useState(0);

    // Dragging the subtitle box. `subDrag` holds the live top while the
    // pointer is down so the box follows it without a write per mouse move;
    // the edge-and-offset form is stored once, on release.
    const subBoxRef = useRef(null);
    const [subDrag, setSubDrag] = useState(null);
    const subDragRef = useRef(null);
    subDragRef.current = subDrag;
    // Set once a press has travelled far enough to be a drag; read by the
    // word-lookup click so a drag that ends on a word does not also open it.
    const subMovedRef = useRef(false);
    const [subHover, setSubHover] = useState(false);

    // The picture's own width, which is what the subtitle is sized against —
    // not the window's, since a letterboxed video leaves bars either side.
    const [areaWidth, setAreaWidth] = useState(0);
    useEffect(() => {
        const el = wrapperRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setAreaWidth(entry.contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // Usable text width: the box's share of the picture, less its padding.
    const subTextWidth = Math.max(
        120,
        Math.round(areaWidth * (subStyle.widthPct / 100)) - 32
    );

    useEffect(() => {
        const api = getElectronAPI();
        if (!api?.getAutoNext || !videoPath) { setAutoNext(false); return; }
        let dropped = false;
        api.getAutoNext(api.path.dirname(videoPath)).then(r => {
            if (!dropped) setAutoNext(Boolean(r.autoNext));
        });
        return () => { dropped = true; };
    }, [videoPath]);

    const toggleAutoNext = useCallback(async () => {
        const api = getElectronAPI();
        if (!api?.setAutoNext || !videoPath) return;
        const want = !autoNext;
        const r = await api.setAutoNext(api.path.dirname(videoPath), want);
        if (r.success) {
            setAutoNext(want);
            if (!want) setUpNext(null);
        }
    }, [autoNext, videoPath]);

    // A menu anchored to the bar is orphaned if the bar fades out under it.
    const barMenuOpen = episodesOpen || styleOpen;
    useEffect(() => {
        const el = controlsSlot?.closest('.plyr');
        if (!el) return;
        el.classList.toggle('revid-menu-open', barMenuOpen);
        return () => el.classList.remove('revid-menu-open');
    }, [controlsSlot, barMenuOpen]);

    // Tell the shell how much of the right edge is spoken for, so its toasts
    // land beside the panel instead of on it. Reset on the way out.
    const rightPanelOpen = wordbookOpen || transcriptOpen;
    useEffect(() => {
        onRightPanelWidth?.(rightPanelOpen ? RIGHT_PANEL_WIDTH : 0);
    }, [rightPanelOpen, onRightPanelWidth]);
    useEffect(() => () => onRightPanelWidth?.(0), [onRightPanelWidth]);
    const [cutting, setCutting] = useState(null); // { pct } | null
    const [transcribing, setTranscribing] = useState(null); // { pct } | null
    const [whisperMissing, setWhisperMissing] = useState(false);
    const [installing, setInstalling] = useState(null); // { stage, pct } | null
    const [subsRetry, setSubsRetry] = useState(0);
    const cuesRef = useRef(cues);
    cuesRef.current = cues;
    // Read inside the timeupdate listener without rebinding it per change.
    const subShiftRef = useRef(0);
    subShiftRef.current = subStyle.timeShift || 0;

    // A-B loop + resume prompt + glow
    // Index of the cue being drilled, or -1.
    const [loopCueIndex, setLoopCueIndex] = useState(-1);
    const loopCueRef = useRef(-1);
    loopCueRef.current = loopCueIndex;

    // Shadowing: after each line, hold for as long as the line took so there
    // is room to say it back, then carry on.
    const [shadowing, setShadowing] = useState(false);
    const [shadowWait, setShadowWait] = useState(0); // seconds left in the gap
    const shadowRef = useRef(false);
    shadowRef.current = shadowing;
    const shadowTimerRef = useRef(null);
    const shadowDoneRef = useRef(-1); // cue already paused on, so it fires once

    const [abLoop, setAbLoop] = useState(null); // { a, b|null }
    const abRef = useRef(abLoop);
    abRef.current = abLoop;
    const [resumePrompt, setResumePrompt] = useState(null); // { time } | null
    const resumeTimerRef = useRef(0);
    const [autoSubs, setAutoSubs] = useState(() => readBool(AUTO_SUBS_KEY, true));
    const [glowOn, setGlowOn] = useState(() => readBool(GLOW_KEY, true));
    const glowOnRef = useRef(glowOn);
    glowOnRef.current = glowOn;
    // Read inside the subtitle effect without making the toggle re-trigger it.
    const autoSubsRef = useRef(autoSubs);
    autoSubsRef.current = autoSubs;

    // Keep the latest playback prefs in refs so the (src-only) effects can
    // re-apply them to the element without re-running on each change.
    const prefsRef = useRef({ speed, boost, loop });
    prefsRef.current = { speed, boost, loop };

    const videoPathRef = useRef(videoPath);
    videoPathRef.current = videoPath;
    const lastResumeSaveRef = useRef(0);

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
                // source → slotIn → slotOut → gain → speakers. slotIn/slotOut
                // are a fixed pair audio plugins splice themselves between, so
                // the player can rebuild its own chain independently of them.
                const slotIn = ctx.createGain();
                const slotOut = ctx.createGain();
                slotIn.connect(slotOut);
                sourceRef.current.connect(slotIn);
                slotOut.connect(gainRef.current).connect(ctx.destination);
                slotRef.current = { context: ctx, input: slotIn, output: slotOut };
                setAudioSlot(slotRef.current);
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
        setSpeed(value); // not persisted — resets to 1x on the next video
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

    const toggleAutoSubs = useCallback(() => {
        setAutoSubs(prev => {
            const next = !prev;
            localStorage.setItem(AUTO_SUBS_KEY, next ? 'on' : 'off');
            if (!next) {
                // Drop the folder sweep and stop the running job outright.
                getElectronAPI()?.clearTranscriptionQueue?.();
                getElectronAPI()?.cancelFfmpeg?.('whisper');
            } else {
                setSubsRetry(n => n + 1);
            }
            return next;
        });
    }, []);

    const toggleGlow = useCallback(() => {
        setGlowOn((prev) => {
            const next = !prev;
            localStorage.setItem(GLOW_KEY, next ? 'on' : 'off');
            if (!next && glowRef.current) glowRef.current.style.opacity = '0';
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

    const seekTo = useCallback((time) => {
        const video = videoElRef.current;
        if (!video) return;
        video.currentTime = time;
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    }, []);

    // The current src, readable from listeners that outlive a single source.
    const srcRef = useRef(src);
    srcRef.current = src;
    // The 'ended' listener is attached once, for the life of the player, so
    // everything it reads has to come from a ref — a closure would hold the
    // first episode's values forever.
    const autoNextRef = useRef(autoNext);
    autoNextRef.current = autoNext;
    const filesRef = useRef(files);
    filesRef.current = files;
    const onSelectVideoRef = useRef(onSelectVideo);
    onSelectVideoRef.current = onSelectVideo;
    const flashTimerRef = useRef(0);

    // Build the <video> + Plyr ONCE. Switching videos only swaps the src on
    // the same element — no player teardown, no DOM churn, and the Web Audio
    // boost graph (bound to the element, not the source) survives switches.
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        wrapper.innerHTML = '';
        const video = document.createElement('video');
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.preload = 'auto';
        video.crossOrigin = 'anonymous'; // lets the glow canvas sample frames
        wrapper.appendChild(video);
        videoElRef.current = video;

        const player = new Plyr(video, {
            controls: [
                'play-large', 'play', 'progress', 'current-time',
                'duration', 'mute', 'volume', 'settings', 'pip', 'fullscreen'
            ],
            settings: ['speed'],
            speed: { selected: 1, options: SPEED_OPTIONS },
            tooltips: { controls: false, seek: true },
            // Global so shortcuts work without first clicking the player:
            // ←/→ seek, Space/K play, ↑/↓ volume, M mute, F fullscreen, 0-9 seek%.
            keyboard: { focused: true, global: true },
            seekTime: 5,
            autoplay: true
        });
        plyrRef.current = player;

        // Playback-side controls belong in the player's own bar, not stacked
        // in a second row over the picture. Plyr owns that DOM, so claim a
        // slot in its right-hand cluster and portal into it — ahead of
        // fullscreen, which stays last the way it does everywhere else.
        // Safe because switching videos assigns video.src directly: Plyr's
        // own source setter would rebuild this bar and drop the slot.
        const bar = wrapper.querySelector('.plyr__controls');
        if (bar) {
            const slot = document.createElement('div');
            slot.className = 'revid-plyr-slot';
            bar.insertBefore(slot, bar.querySelector('[data-plyr="fullscreen"]'));
            setControlsSlot(slot);
        }

        const onTimeUpdate = () => {
            const tNow = video.currentTime;
            // Share the playback position with the editor. Tagged with src so a
            // stale position from another video is never applied.
            if (timeRef) timeRef.current = { src: srcRef.current, time: tNow };

            // Subtitle cue under the playhead. The sync nudge shifts the cue
            // timeline, so look the cue up at the un-shifted position.
            const idx = findActiveCueIndex(cuesRef.current, tNow - subShiftRef.current);
            setActiveCueIndex((prev) => (prev === idx ? prev : idx));

            // A-B loop. The sentence drill loops on its own rAF ticker —
            // timeupdate only fires ~4x a second, which is too coarse to cut
            // cleanly at the end of a sentence.
            if (loopCueRef.current < 0) {
                const ab = abRef.current;
                if (ab && ab.b != null && tNow >= ab.b) {
                    video.currentTime = ab.a;
                }
            }

            // Position within this app session. Survives a remount — a hot
            // reload in dev, a view switch, a key bump — so the video picks up
            // where it was instead of restarting.
            try {
                sessionStorage.setItem(LIVE_POS_KEY, JSON.stringify({ src: srcRef.current, time: tNow }));
            } catch (e) { /* storage disabled */ }

            // Cross-restart resume position (throttled).
            const now = Date.now();
            if (now - lastResumeSaveRef.current > 3000 && videoPathRef.current && tNow > 5) {
                lastResumeSaveRef.current = now;
                saveResumePosition(videoPathRef.current, tNow, video.duration || 0);
            }
        };
        video.addEventListener('timeupdate', onTimeUpdate);

        // Ambient glow: sample the frame tiny + blur it huge behind the video.
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = 32;
        glowCanvas.height = 18;
        const glowCtx = glowCanvas.getContext('2d');
        const glowTimer = setInterval(() => {
            const el = glowRef.current;
            if (!el) return;
            if (!glowOnRef.current || video.readyState < 2) { el.style.opacity = '0'; return; }
            try {
                glowCtx.drawImage(video, 0, 0, 32, 18);
                el.style.backgroundImage = `url(${glowCanvas.toDataURL('image/jpeg', 0.5)})`;
                el.style.opacity = '0.5';
            } catch {
                el.style.opacity = '0'; // tainted canvas — glow off, playback unaffected
            }
        }, 700);

        return () => {
            clearInterval(glowTimer);
            clearTimeout(flashTimerRef.current);
            clearTimeout(resumeTimerRef.current);
            video.removeEventListener('timeupdate', onTimeUpdate);
            setControlsSlot(null);
            player.destroy();
            plyrRef.current = null;
            videoElRef.current = null;
            try { sourceRef.current?.disconnect(); } catch {}
            try { gainRef.current?.disconnect(); } catch {}
            sourceRef.current = null;
            gainRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Source switch: swap src on the existing element and re-apply playback
    // prefs once metadata arrives. A cached thumbnail doubles as the poster so
    // the frame area isn't black while the first frame decodes.
    useEffect(() => {
        const video = videoElRef.current;
        const player = plyrRef.current;
        if (!video || !player || !src) return;

        // Each new video starts at the natural 1x; volume boost carries over.
        setSpeed(1);
        setAbLoop(null);
        setResumePrompt(null);
        clearTimeout(resumeTimerRef.current);
        const poster = getCachedThumbnail(src);
        if (poster) video.poster = poster;
        video.loop = prefsRef.current.loop;
        video.src = src;

        // Perceived responsiveness: pop the control bar out the instant a new
        // video is entered, so the UI visibly reacts while the first frame is
        // still decoding. toggleControls() loses the race against autoplay's
        // idle auto-hide, so force visibility with a CSS override class and
        // hand control back to Plyr when it drops.
        const container = player.elements?.container;
        if (container) {
            container.classList.add('revid-flash-controls');
            clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => {
                container.classList.remove('revid-flash-controls');
            }, 2500);
        }

        const reapply = () => {
            video.playbackRate = 1;
            const { boost: b } = prefsRef.current;
            if (b !== 1) {
                const gain = ensureGain();
                if (gain) gain.gain.value = b;
            }
            // Coming back from the editor (or the grid), resume where this
            // same video last was instead of restarting from zero. The
            // in-session position is also checked because a remount can
            // outlive the ref that holds it (App itself reloading in dev).
            const saved = timeRef?.current;
            let live = null;
            try {
                const raw = sessionStorage.getItem(LIVE_POS_KEY);
                if (raw) live = JSON.parse(raw);
            } catch (e) { /* storage disabled */ }

            if (saved && saved.src === src && Number.isFinite(saved.time) && saved.time > 0) {
                video.currentTime = saved.time;
            } else if (live && live.src === src && Number.isFinite(live.time) && live.time > 0) {
                video.currentTime = live.time;
            } else if (videoPathRef.current) {
                // Fresh open: offer (not force) the cross-restart position.
                const stored = readResumeMap()[videoPathRef.current];
                if (stored && stored.time > 30 && video.duration - stored.time > 20) {
                    setResumePrompt({ time: stored.time });
                    clearTimeout(resumeTimerRef.current);
                    resumeTimerRef.current = setTimeout(() => setResumePrompt(null), 8000);
                }
            }
            // "Open and it plays": kick off playback once the video is ready.
            // Electron allows autoplay with sound; ignore the promise rejection
            // if a browser policy ever blocks it.
            const p = player.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        };
        video.addEventListener('loadedmetadata', reapply, { once: true });
        return () => video.removeEventListener('loadedmetadata', reapply);
    }, [src, ensureGain]);

    // Subtitles: load the same-name .srt/.vtt, or quietly transcribe with
    // Whisper in the background ("偷跑") while the user watches.
    useEffect(() => {
        setCues([]);
        setActiveCueIndex(-1);
        setTranscribing(null);
        setWhisperMissing(false);
        const api = getElectronAPI();
        if (!api || !videoPath) return;

        let cancelled = false;
        let live = [];
        (async () => {
            // Subtitles live in the folder's .revid library; the main process
            // falls back to a sidecar if the user brought one.
            const stored = await api.readSubtitleCues?.(videoPath);
            if (cancelled) return;
            if (stored?.cues?.length) { setCues(stored.cues); return; }
            if (!autoSubsRef.current) return;

            const status = await api.whisperStatus();
            if (cancelled) return;
            if (!status.success || !status.binaryReady || !status.modelReady) {
                setWhisperMissing(true);
                return;
            }
            setTranscribing({ pct: 0 });
            const result = await api.transcribeVideo(videoPath, (ev) => {
                if (cancelled) return;
                if (ev.type === 'cue') {
                    live = [...live, ev.cue];
                    setCues(live);
                } else if (ev.type === 'progress') {
                    setTranscribing({ pct: ev.pct });
                }
            });
            if (cancelled) return;
            setTranscribing(null);
            if (result.success) {
                const finished = await api.readSubtitleCues?.(videoPath);
                if (!cancelled && finished?.cues?.length) setCues(finished.cues);
            }
        })();

        // Leaving the video does NOT stop its transcription: the main process
        // serialises jobs in a queue, so letting it finish costs nothing extra
        // and the result is saved. Stopping it would throw away the work and
        // force a full re-run the next time this video is opened.
        return () => { cancelled = true; };
    }, [videoPath, subsRetry]);

    // One-time Whisper engine/model download, then transcribe this video.
    const handleWhisperSetup = useCallback(async () => {
        const api = getElectronAPI();
        if (!api) return;
        setWhisperMissing(false);
        setInstalling({ stage: 'binary', pct: 0 });
        const result = await api.whisperSetup({ flavor: 'cuda' }, (p) => setInstalling(p));
        setInstalling(null);
        if (result.success) setSubsRetry(n => n + 1);
        else setWhisperMissing(true);
    }, []);

    const pickCc = useCallback((next) => {
        localStorage.setItem(CC_KEY, next);
        setCcMode(next);
    }, []);

    // Translate the loaded cues to Chinese and keep the result on each cue.
    // The main process also writes a .zh.srt so this happens once per video.
    const translateCues = useCallback(async () => {
        const api = getElectronAPI();
        const current = cuesRef.current;
        if (!api || !videoPath || current.length === 0 || translating) return;

        if (typeof api.translateSubtitles !== 'function') {
            setTranslateError(t('translateRestartNeeded'));
            return;
        }

        setTranslateError(null);
        setTranslating({ pct: 0 });
        let result;
        try {
            result = await api.translateSubtitles({
                videoPath,
                cues: current.map(c => ({ start: c.start, end: c.end, text: c.text })),
                engine: localStorage.getItem(TRANSLATE_ENGINE_KEY) || 'google',
                apiKey: localStorage.getItem(GEMINI_KEY) || '',
                model: localStorage.getItem(GEMINI_MODEL_KEY) || ''
            }, (pct) => setTranslating({ pct }));
        } catch (err) {
            result = { success: false, error: err.message || String(err) };
        }
        setTranslating(null);

        if (result.success) {
            setCues(prev => prev.map((c, i) => ({ ...c, zh: result.translations[i] || c.zh })));
        } else if (!result.cancelled) {
            setTranslateError(result.needsKey ? t('translateNeedsKey') : result.error);
        }
    }, [videoPath, translating, t]);

    // Auto-translate once subtitles exist. Like transcription this runs in the
    // background while the user watches — on by default, off via settings.
    useEffect(() => {
        if (localStorage.getItem(AUTO_TRANSLATE_KEY) === 'off') return;
        if (cues.length === 0 || cues.some(c => c.zh) || translating || transcribing) return;
        translateCues();
    }, [cues, translating, transcribing, translateCues]);

    // Repeat one sentence until switched off. Jumps there and plays so the
    // drill starts immediately rather than on the next pass.
    const startCueDrill = useCallback((index) => {
        setLoopCueIndex(index);
        if (index < 0) return;
        setAbLoop(null);
        const cue = cuesRef.current[index];
        if (cue) seekTo(cue.start + subShiftRef.current);
    }, [seekTo]);

    // Switching video must not leave a drill pointing at a stale cue index.
    useEffect(() => { setLoopCueIndex(-1); }, [videoPath]);

    const stopShadowTimer = useCallback(() => {
        if (shadowTimerRef.current) {
            clearInterval(shadowTimerRef.current);
            shadowTimerRef.current = null;
        }
        setShadowWait(0);
    }, []);

    // Shadowing runs on its own frame ticker for the same reason the sentence
    // drill does: timeupdate is far too coarse to stop on a line's end.
    useEffect(() => {
        if (!shadowing) { stopShadowTimer(); shadowDoneRef.current = -1; return; }
        let raf = 0;
        const tick = () => {
            const v = videoElRef.current;
            const cues_ = cuesRef.current;
            if (v && !v.paused && cues_.length && !shadowTimerRef.current) {
                const shift = subShiftRef.current;
                const idx = cues_.findIndex(
                    (c, i) => i > shadowDoneRef.current
                        && v.currentTime >= c.end + shift
                        && v.currentTime < c.end + shift + 1
                );
                if (idx >= 0) {
                    shadowDoneRef.current = idx;
                    const cue = cues_[idx];
                    const gap = Math.min(12, Math.max(1.2, (cue.end - cue.start) * 1.1));
                    v.pause();
                    let left = gap;
                    setShadowWait(Math.ceil(left));
                    shadowTimerRef.current = setInterval(() => {
                        left -= 0.1;
                        if (left <= 0) {
                            stopShadowTimer();
                            // Only resume if the user has not taken over.
                            if (shadowRef.current && videoElRef.current?.paused) {
                                videoElRef.current.play().catch(() => {});
                            }
                        } else {
                            setShadowWait(Math.ceil(left));
                        }
                    }, 100);
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { cancelAnimationFrame(raf); stopShadowTimer(); };
    }, [shadowing, stopShadowTimer]);

    // Seeking elsewhere should not leave earlier lines marked as "already
    // shadowed", or jumping back would skip their gaps.
    useEffect(() => {
        if (!shadowing) return;
        const v = videoElRef.current;
        if (!v) return;
        const onSeek = () => {
            const i = findActiveCueIndex(cuesRef.current, v.currentTime - subShiftRef.current);
            shadowDoneRef.current = i - 1;
            stopShadowTimer();
        };
        v.addEventListener('seeked', onSeek);
        return () => v.removeEventListener('seeked', onSeek);
    }, [shadowing, stopShadowTimer]);

    // Frame-accurate sentence loop: check every frame so the line repeats on
    // its own end instead of spilling into the next one.
    useEffect(() => {
        if (loopCueIndex < 0) return;
        let raf = 0;
        const tick = () => {
            const v = videoElRef.current;
            const cue = cuesRef.current[loopCueIndex];
            if (v && cue && !v.paused) {
                const from = cue.start + subShiftRef.current;
                const to = cue.end + subShiftRef.current;
                if (v.currentTime >= to || v.currentTime < from - 0.3) v.currentTime = from;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [loopCueIndex]);

    // Flag words above the learner's level across the whole cue list, in one
    // round-trip rather than per word.
    useEffect(() => {
        const api = getElectronAPI();
        if (!api?.dictMarkDifficult || cues.length === 0 || !learnMode) {
            setDifficultMarks({});
            return;
        }
        let cancelled = false;
        api.dictMarkDifficult(cues.map(c => c.text), {
            tags: difficulty.tags,
            minFreqRank: difficulty.minFreqRank
        }).then((r) => {
            if (cancelled || !r.success) return;
            // Words the reader has retired are dropped here rather than in the
            // dictionary, so the known list stays a renderer-side preference.
            const filtered = {};
            for (const [idx, hits] of Object.entries(r.marks || {})) {
                const keep = hits.filter(h => !knownWords.has(h.base));
                if (keep.length) filtered[idx] = keep;
            }
            setDifficultMarks(filtered);
        });
        return () => { cancelled = true; };
    }, [cues, learnMode, knownWords, difficulty.tags, difficulty.minFreqRank]);

    const pickMode = useCallback((mode) => {
        setViewerMode(prev => {
            // Tapping the active mode returns to plain playback.
            const next = prev === mode ? 'browse' : mode;
            localStorage.setItem(VIEWER_MODE_KEY, next);
            if (next !== 'learn') {
                setWordbookOpen(false);
                setShadowing(false);
            }
            return next;
        });
    }, []);

    const openWordCard = useCallback((word, event, example) => {
        setWordCard({
            word,
            example: example || '',
            anchor: { x: event.clientX, y: event.clientY }
        });
    }, []);

    useEffect(() => {
        if (!wordCard) return;
        const close = () => setWordCard(null);
        const onKey = (e) => { if (e.key === 'Escape') setWordCard(null); };
        window.addEventListener('click', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [wordCard]);

    // Correct a mis-transcribed line and write it back to the .srt, so the
    // fix survives and everything downstream of the transcript uses it.
    const editCue = useCallback((index, text) => {
        setCues(prev => {
            const next = prev.map((c, i) => (i === index ? { ...c, text } : c));
            getElectronAPI()?.saveSubtitles?.(
                videoPath,
                next.map(c => ({ start: c.start, end: c.end, text: c.text })),
                false
            );
            return next;
        });
    }, [videoPath]);

    // Cut the picked lines out of the video and join them — editing by
    // choosing sentences rather than dragging on a timeline.
    const cutSelection = useCallback(async (ranges) => {
        const api = getElectronAPI();
        if (!api?.cutRanges || !videoPath || ranges.length === 0) return;

        const ext = api.path.extname(videoPath);
        const base = api.path.basename(videoPath, ext);
        const picked = await api.showSaveDialog(
            api.path.join(api.path.dirname(videoPath), `${base}-highlights.mp4`)
        );
        if (picked.canceled || !picked.filePath) return;

        setCutting({ pct: 0 });
        let result;
        try {
            result = await api.cutRanges(
                {
                    inputPath: videoPath,
                    // Pad each end slightly: a cue boundary clips the first
                    // and last syllable when taken literally.
                    ranges: ranges.map(r => ({
                        start: Math.max(0, r.start - 0.15),
                        end: r.end + 0.25
                    })),
                    outputPath: picked.filePath
                },
                (pct) => setCutting({ pct })
            );
        } catch (e) {
            result = { success: false, error: e.message };
        }
        setCutting(null);
        if (!result.success && !result.cancelled) {
            setTranslateError(result.error);
        }
    }, [videoPath]);

    // Same picked lines, but finished rather than merely cut: joined, turned
    // vertical and with the subtitles burned in, through the compositor the
    // user's short-form projects already render with.
    const exportReel = useCallback(async (ranges) => {
        const api = getElectronAPI();
        if (!api?.renderReel || !videoPath || ranges.length === 0) return;

        const segments = retimeCues(cuesRef.current, ranges);
        if (segments.length === 0) {
            setTranslateError(t('reelNoSubtitles'));
            return;
        }

        const status = await api.reelRendererStatus?.();
        if (status && !status.available) {
            setTranslateError(t('reelRendererMissing'));
            return;
        }

        const ext = api.path.extname(videoPath);
        const base = api.path.basename(videoPath, ext);
        const picked = await api.showSaveDialog(
            api.path.join(api.path.dirname(videoPath), `${base}-reel.mp4`)
        );
        if (picked.canceled || !picked.filePath) return;

        setCutting({ pct: 0 });
        let result;
        try {
            result = await api.renderReel(
                {
                    inputPath: videoPath,
                    // The cut pads each end; retimeCues used the same padding
                    // to place the lines, so the two must stay in step.
                    ranges: ranges.map(r => ({
                        ...r,
                        start: Math.max(0, r.start - PAD.start),
                        end: r.end + PAD.end
                    })),
                    segments,
                    style: toReelStyle(subStyle),
                    outputPath: picked.filePath
                },
                ({ pct }) => setCutting({ pct })
            );
        } catch (e) {
            result = { success: false, error: e.message };
        }
        setCutting(null);
        if (!result.success && !result.cancelled) {
            setTranslateError(result.error);
        }
    }, [videoPath, subStyle, t]);

    // Drag the subtitle anywhere in the frame. The box is the handle — no grip
    // to find — and a press that never travels is still a word lookup.
    const startSubDrag = useCallback((e) => {
        const box = subBoxRef.current;
        const area = wrapperRef.current;
        if (!box || !area) return;
        const boxRect = box.getBoundingClientRect();
        const areaRect = area.getBoundingClientRect();
        e.stopPropagation();   // not a seek, not a play/pause
        subMovedRef.current = false;
        setSubDrag({
            top: boxRect.top - areaRect.top,
            boxHeight: boxRect.height,
            areaHeight: areaRect.height,
            grabY: e.clientY,
            grabTop: boxRect.top - areaRect.top
        });
    }, []);

    useEffect(() => {
        if (!subDrag) return;
        const onMove = (e) => {
            const d = subDragRef.current;
            if (!d) return;
            const travelled = Math.abs(e.clientY - d.grabY);
            if (travelled > DRAG_THRESHOLD) subMovedRef.current = true;
            setSubDrag({
                ...d,
                top: clampTop({
                    top: d.grabTop + (e.clientY - d.grabY),
                    boxHeight: d.boxHeight,
                    areaHeight: d.areaHeight
                })
            });
        };
        const onUp = () => {
            const d = subDragRef.current;
            setSubDrag(null);
            if (!d || !subMovedRef.current) return;   // a click, not a move
            setSubStyle(s => ({ ...s, ...dropAnchor(d) }));
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [Boolean(subDrag)]);

    // Resizing: the sides set the width, the corner sets the text size. Both
    // run through the same press/move/release as moving does, so a handle
    // never also drags the box.
    const [subResize, setSubResize] = useState(null);
    const subResizeRef = useRef(null);
    subResizeRef.current = subResize;

    const startSubResize = useCallback((kind) => (e) => {
        const area = wrapperRef.current;
        const box = subBoxRef.current;
        if (!area || !box) return;
        e.stopPropagation();
        e.preventDefault();
        const areaRect = area.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        const centreX = areaRect.left + areaRect.width / 2;
        setSubResize({
            kind,
            centreX,
            areaWidth: areaRect.width,
            // Where the grabbed edge was, so a corner scales relative to the
            // size it had when grabbed rather than jumping on the first move.
            startHalfWidth: Math.max(8, Math.abs(e.clientX - centreX)),
            startWidthPct: subStyle.widthPct,
            startFont: subStyle.fontSize,
            boxWidth: boxRect.width
        });
    }, [subStyle.widthPct, subStyle.fontSize]);

    useEffect(() => {
        if (!subResize) return undefined;
        const onMove = (e) => {
            const r = subResizeRef.current;
            if (!r) return;
            if (r.kind === 'width') {
                setSubStyle(s => ({
                    ...s,
                    widthPct: widthPctFrom({
                        pointerX: e.clientX, centreX: r.centreX, areaWidth: r.areaWidth
                    })
                }));
            } else {
                // A corner takes the whole subtitle with it — background and
                // all — which is what a corner handle does everywhere else.
                setSubStyle(s => ({ ...s, ...scaleFrom({ ...r, pointerX: e.clientX }) }));
            }
        };
        const onUp = () => setSubResize(null);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [Boolean(subResize)]);

    // The editing chrome is on while the pointer is over the subtitle, and
    // stays on through a drag that has wandered off it.
    const subUiOn = subHover || Boolean(subDrag) || Boolean(subResize);

    // Back where it started, for when a drag has put it somewhere silly.
    const resetSubPosition = useCallback(() => {
        setSubStyle(s => ({
            ...s,
            position: DEFAULT_SUBTITLE_STYLE.position,
            offset: DEFAULT_SUBTITLE_STYLE.offset
        }));
    }, []);

    // Playing on to the next episode. The countdown exists so this is an
    // offer rather than something that happens to you — a folder is not
    // always a series, and the player cannot tell.
    useEffect(() => {
        const video = videoElRef.current;
        if (!video) return;
        const onEnded = () => {
            const target = shouldOfferNext({
                enabled: autoNextRef.current,
                // Only a half-made A-B marker counts as work in progress.
                marking: Boolean(abRef.current && abRef.current.b == null),
                visibleFiles: filesRef.current,
                current: videoPathRef.current
            });
            if (target) setUpNext({ target, deadline: deadlineFrom(Date.now()) });
        };
        video.addEventListener('ended', onEnded);
        return () => video.removeEventListener('ended', onEnded);
    }, []);

    // Anything the user does cancels it. The interval only forces a repaint —
    // the deadline decides when it fires, so re-render churn cannot stall it.
    useEffect(() => {
        if (!upNext) return;
        const timer = setInterval(() => {
            if (Date.now() >= upNext.deadline) {
                clearInterval(timer);
                const go = upNext.target;
                setUpNext(null);
                onSelectVideoRef.current?.(filesRef.current.indexOf(go));
            } else {
                tickCountdown(n => n + 1);
            }
        }, 250);
        const cancel = () => setUpNext(null);
        window.addEventListener('keydown', cancel);
        window.addEventListener('pointerdown', cancel);
        return () => {
            clearInterval(timer);
            window.removeEventListener('keydown', cancel);
            window.removeEventListener('pointerdown', cancel);
        };
    }, [upNext?.target, upNext?.deadline]);

    // Landing on a line found by search. Switching videos is already handled
    // by the resume path on loadedmetadata; this covers the case where the hit
    // is in the video that happens to be playing.
    useEffect(() => {
        if (!seekRequest || seekRequest.src !== src) return;
        const video = videoElRef.current;
        if (!video || video.readyState < 1) return;
        seekTo(seekRequest.time);
    }, [seekRequest, src, seekTo]);

    // Subtitles live in the library file; write real .srt files only when
    // the user wants them — for another player, or to hand to someone.
    const exportSrt = useCallback(async () => {
        const api = getElectronAPI();
        if (!api?.exportSrt || !videoPath) return;
        const result = await api.exportSrt(videoPath, cuesRef.current.some(c => c.zh));
        if (!result.success) setTranslateError(result.error);
    }, [videoPath]);

    // Discard this video's subtitles and run them again.
    const retranscribe = useCallback(async () => {
        const api = getElectronAPI();
        if (!api?.retranscribeVideo || !videoPath || transcribing) return;
        if (!window.confirm(t('retranscribeConfirm'))) return;
        setCues([]);
        setActiveCueIndex(-1);
        setTranscribing({ pct: 0 });
        let live = [];
        const result = await api.retranscribeVideo(videoPath, (ev) => {
            if (ev.type === 'cue') { live = [...live, ev.cue]; setCues(live); }
            else if (ev.type === 'progress') setTranscribing({ pct: ev.pct });
        });
        setTranscribing(null);
        if (result?.success) setSubsRetry(n => n + 1);
    }, [videoPath, transcribing, t]);

    const toggleTranscript = useCallback(() => {
        setTranscriptOpen(prev => {
            localStorage.setItem(TRANSCRIPT_KEY, prev ? 'off' : 'on');
            return !prev;
        });
    }, []);

    // A-B loop keys: [ sets A, ] sets B (starts looping), \ clears.
    useEffect(() => {
        const onKey = (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const el = e.target;
            if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
            const video = videoElRef.current;
            if (!video) return;

            if (e.key === '[') {
                e.preventDefault();
                const a = video.currentTime;
                setAbLoop(prev => ({ a, b: prev && prev.b != null && prev.b > a ? prev.b : null }));
            } else if (e.key === ']') {
                e.preventDefault();
                const b = video.currentTime;
                setAbLoop(prev => {
                    const a = prev ? prev.a : 0;
                    return b > a + 0.2 ? { a, b } : prev;
                });
            } else if (e.key === '\\') {
                e.preventDefault();
                setAbLoop(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Close the AudioContext when the viewer unmounts entirely.
    useEffect(() => () => {
        setAudioSlot(null);
        slotRef.current = null;
        try { audioCtxRef.current?.close(); } catch {}
        audioCtxRef.current = null;
    }, []);

    // Expose player + subtitle state to plugins. Reads go through refs so the
    // bridge identity stays stable for a plugin that holds onto it.
    const cuesForPluginsRef = useRef({ cues, activeCueIndex });
    cuesForPluginsRef.current = { cues, activeCueIndex };
    useEffect(() => {
        setAudioSlotProvider(() => ensureGain());
        return () => setAudioSlotProvider(null);
    }, [ensureGain]);

    useEffect(() => {
        setPlayerBridge({
            play: () => videoElRef.current?.play().catch(() => {}),
            pause: () => videoElRef.current?.pause(),
            seek: (time) => { if (videoElRef.current) videoElRef.current.currentTime = time; },
            getCurrentTime: () => videoElRef.current?.currentTime ?? 0,
            getDuration: () => videoElRef.current?.duration ?? 0,
            isPaused: () => videoElRef.current?.paused ?? true,
            getCues: () => cuesForPluginsRef.current.cues,
            getActiveCue: () => {
                const { cues: c, activeCueIndex: i } = cuesForPluginsRef.current;
                return i >= 0 ? c[i] : null;
            }
        });
        return () => setPlayerBridge(null);
    }, []);

    // Press "0" to restart the current video from the beginning (and keep
    // playing). Global so it works even when the Plyr player isn't focused —
    // but ignored while typing in an input so it never eats a real "0".
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== '0' || e.ctrlKey || e.metaKey || e.altKey) return;
            const el = e.target;
            const tag = el?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
            const player = plyrRef.current;
            if (!player) return;
            e.preventDefault();
            try {
                player.currentTime = 0;
                const p = player.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch { /* player not ready */ }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Close the subtitle-style popover on outside click / Escape.
    useEffect(() => {
        if (!styleOpen) return;
        const close = () => setStyleOpen(false);
        const onKey = (e) => { if (e.key === 'Escape') setStyleOpen(false); };
        window.addEventListener('click', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [styleOpen]);

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
        const MENU_W = 230, MENU_H = 290;
        const x = Math.min(e.clientX, window.innerWidth - MENU_W);
        const y = Math.min(e.clientY, window.innerHeight - MENU_H);
        setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
    }, []);

    const activeCue = activeCueIndex >= 0 ? cues[activeCueIndex] : null;
    const showOrig = ccMode === 'both' || ccMode === 'orig';
    const showZh = ccMode === 'both' || ccMode === 'zh';
    const hasTranslation = cues.some(c => c.zh);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', background: '#000' }}>
            {/* Player area */}
            <div
                onContextMenu={openMenu}
                style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}
            >
                {/* Ambient glow behind the video */}
                <div
                    ref={glowRef}
                    style={{
                        position: 'absolute', inset: '-8%', zIndex: 0,
                        backgroundSize: 'cover', backgroundPosition: 'center',
                        filter: 'blur(64px) saturate(1.4)',
                        opacity: 0, transition: 'opacity 0.6s',
                        pointerEvents: 'none'
                    }}
                />
                <div ref={wrapperRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

                {/* CC subtitle overlay — original on top, translation below */}
                {/* A cue that was nothing but a speaker marker is empty once
                    it is cleaned; an empty box over the picture is worse than
                    no box. */}
                {ccMode !== 'off' && activeCue && (showOrig || showZh)
                    && ((showOrig && activeCue.text) || (showZh && activeCue.zh)) && (
                    <div
                        ref={subBoxRef}
                        onPointerDown={startSubDrag}
                        onDoubleClick={(e) => { e.stopPropagation(); resetSubPosition(); }}
                        onPointerEnter={() => setSubHover(true)}
                        onPointerLeave={() => setSubHover(false)}
                        title={t('subDragHint')}
                        style={{
                            position: 'absolute', left: '50%', zIndex: 4,
                            // While dragging, follow the pointer directly; the
                            // edge-anchored form is written once on release.
                            ...(subDrag
                                ? { top: subDrag.top, bottom: 'auto' }
                                : { [subStyle.position]: subStyle.offset }),
                            transform: 'translateX(-50%)',
                            maxWidth: `${subStyle.widthPct}%`, padding: '7px 16px',
                            background: `rgba(0,0,0,${subStyle.bgOpacity})`,
                            borderRadius: 8,
                            textAlign: 'center', whiteSpace: 'pre-wrap',
                            // The box is the drag handle. Its text keeps its own
                            // pointer events so words stay clickable.
                            pointerEvents: 'auto',
                            cursor: subDrag ? 'grabbing' : 'grab',
                            // A hairline frame while the pointer is on it, so
                            // the handles read as the corners of one object
                            // rather than marks floating over the picture.
                            outline: subUiOn
                                ? `1px solid rgba(255,255,255,${subDrag || subResize ? 0.45 : 0.25})`
                                : 'none',
                            userSelect: 'none',
                            backdropFilter: subStyle.bgOpacity > 0 ? 'blur(2px)' : 'none'
                        }}>
                        {/* Editor-style handles: the sides set the width, the
                            corner sets the text size. Hidden until the pointer
                            is on the box so they never sit over the picture. */}
                        {['left', 'right'].map(side => (
                            <div
                                key={side}
                                onPointerDown={startSubResize('width')}
                                // The grab area is generous; only the tick
                                // inside it is drawn, so the pointer target
                                // does not have to be the eyesore.
                                style={{
                                    position: 'absolute', [side]: -7, top: '50%',
                                    width: 14, height: 34, marginTop: -17,
                                    cursor: 'ew-resize',
                                    display: 'flex', alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: subUiOn ? 1 : 0,
                                    transition: 'opacity 0.12s'
                                }}
                            >
                                <div style={{
                                    width: 3, height: 18, borderRadius: 2,
                                    background: 'rgba(255,255,255,0.8)',
                                    boxShadow: '0 0 2px rgba(0,0,0,0.6)'
                                }} />
                            </div>
                        ))}
                        {/* Four corners, like a crop frame. Each one scales
                            the whole subtitle, background included. */}
                        {[
                            { top: -8, left: -8, cursor: 'nwse-resize' },
                            { top: -8, right: -8, cursor: 'nesw-resize' },
                            { bottom: -8, left: -8, cursor: 'nesw-resize' },
                            { bottom: -8, right: -8, cursor: 'nwse-resize' }
                        ].map(({ cursor, ...pos }, i) => (
                            <div
                                key={i}
                                onPointerDown={startSubResize('scale')}
                                title={t('subResizeHint')}
                                style={{
                                    position: 'absolute', ...pos, cursor,
                                    width: 16, height: 16,
                                    display: 'flex', alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: subUiOn ? 1 : 0,
                                    transition: 'opacity 0.12s'
                                }}
                            >
                                <div style={{
                                    width: 7, height: 7, borderRadius: 1,
                                    background: '#fff',
                                    boxShadow: '0 0 0 1px rgba(0,0,0,0.55)'
                                }} />
                            </div>
                        ))}
                        <SubtitleCue
                            videoRef={videoElRef}
                            cue={activeCue}
                            showOrig={showOrig}
                            showZh={showZh}
                            widthPx={subTextWidth}
                            fontSize={subStyle.fontSize}
                            marks={difficultMarks[activeCueIndex]}
                            markColor={theme.pin}
                            textStyle={subtitleTextStyle(subStyle)}
                            // A drag that happens to end on a word moved the
                            // subtitle; it did not ask what the word means.
                            // Cleared on use so it cannot leak into the next
                            // click.
                            onWordClick={(w, e) => {
                                if (subMovedRef.current) {
                                    subMovedRef.current = false;
                                    return;
                                }
                                openWordCard(w, e, activeCue.text);
                            }}
                        />
                    </div>
                )}

                {/* Top-right: CC + transcript toggles, transcription status */}
                <div style={{
                    position: 'absolute', top: 12, right: 12, zIndex: 5,
                    display: 'flex', alignItems: 'center', gap: 6
                }}>
                    {transcribing && (
                        <span style={pill}>
                            {t('transcriptFirstRun')} {transcribing.pct}%
                        </span>
                    )}
                    {installing && (
                        <span style={pill}>
                            {installing.stage === 'binary' ? t('whisperInstallingBin') : t('whisperInstallingModel')}
                            {' '}{installing.pct}%
                        </span>
                    )}
                    {whisperMissing && !installing && (
                        <button onClick={handleWhisperSetup} style={{ ...pill, cursor: 'pointer' }}>
                            {t('whisperSetupNeeded')}
                        </button>
                    )}
                    {cutting && (
                        <span style={pill}>{t('transcriptCutting')} {cutting.pct}%</span>
                    )}
                    {translating && (
                        <span style={pill}>{t('translating')} {translating.pct}%</span>
                    )}
                    {translateError && (
                        <span style={{ ...pill, color: '#f87171', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {translateError}
                        </span>
                    )}
                    {cues.length > 0 && !hasTranslation && !translating && (
                        <button onClick={translateCues} style={{ ...pill, cursor: 'pointer' }}>
                            {t('translateToZh')}
                        </button>
                    )}
                    {/* One switch instead of scattered toggles: browse is a
                        plain player, the other two add their own affordances. */}
                    <div style={{
                        display: 'flex', borderRadius: 6, overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,0.15)'
                    }}>
                        {['learn', 'edit'].map((mode) => {
                            const allowed = hasFeature(
                                mode === 'learn' ? FEATURES.LEARNING : FEATURES.TRANSCRIPT_TOOLS
                            );
                            return (
                                <button
                                    key={mode}
                                    title={allowed ? t(`mode_${mode}_hint`) : t('advancedOnly')}
                                    onClick={() => (allowed ? pickMode(mode) : onUpgrade?.())}
                                    style={{
                                        height: 28, padding: '0 10px', fontSize: 11, fontWeight: 600,
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        background: viewerMode === mode ? 'rgba(59,130,246,0.85)' : 'rgba(0,0,0,0.55)',
                                        color: allowed ? '#fff' : 'rgba(255,255,255,0.55)'
                                    }}
                                >
                                    {t(`mode_${mode}`)}
                                    {!allowed && <Lock size={10} />}
                                </button>
                            );
                        })}
                    </div>
                    {learnMode && (
                        <>
                            <button
                                title={t('shadowHint')}
                                onClick={() => setShadowing(s => !s)}
                                style={{ ...iconBtn(shadowing), width: 'auto', padding: '0 9px', fontSize: 11, fontWeight: 600 }}
                            >
                                {t('shadow')}
                            </button>
                            <button
                                title={t('wordbookTitle')}
                                onClick={() => { setWordbookOpen(o => !o); setTranscriptOpen(false); }}
                                style={iconBtn(wordbookOpen)}
                            >
                                <BookMarked size={16} />
                            </button>
                        </>
                    )}
                    <button
                        title={t('transcriptToggle')}
                        onClick={toggleTranscript}
                        style={iconBtn(transcriptOpen)}
                    >
                        <PanelRight size={16} />
                    </button>
                    <PluginPanelHost />
                </div>

                {/* Playback controls, living in Plyr's own bar */}
                {controlsSlot && createPortal(
                    <>
                        {files.length > 1 && (
                            <button
                                title={t('episodes')}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setStyleOpen(false);
                                    setEpisodesOpen(o => !o);
                                }}
                                style={barBtn(episodesOpen)}
                            >
                                <ListVideo size={15} />
                                {`${currentIndex + 1}/${files.length}`}
                            </button>
                        )}
                        {/* Only alongside the episode list: there is nothing to
                            play on to in a folder of one. */}
                        {files.length > 1 && (
                            <button
                                title={t(autoNext ? 'autoNextOn' : 'autoNextOff')}
                                onClick={(e) => { e.stopPropagation(); toggleAutoNext(); }}
                                style={barBtn(autoNext)}
                            >
                                <SkipForward size={15} />
                            </button>
                        )}
                        {/* Named, never lit: subtitles are on nearly always,
                            so an active tint here would just be permanent
                            blue. Which track is on is the menu's job to say. */}
                        <button
                            title={t('subMenuTitle')}
                            onClick={(e) => {
                                e.stopPropagation();
                                setEpisodesOpen(false);
                                setStyleOpen(o => !o);
                            }}
                            style={barBtn(false)}
                        >
                            <Captions size={15} />
                            {t('subMenuTitle')}
                        </button>
                    </>,
                    controlsSlot
                )}

                {/* Bottom right, above the bar: a video that just ended has
                    nothing to see, but the next one's name does need reading,
                    and anything the user does cancels it. */}
                {upNext && (
                    <div
                        // The cancel-on-any-input listener lives on window and
                        // pointerdown beats click, so without this the card's
                        // own buttons would cancel the countdown out from
                        // under themselves before firing.
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        style={{
                            position: 'absolute', bottom: 80, right: 16, zIndex: 7,
                            width: 300, maxWidth: 'calc(100% - 32px)',
                            padding: '12px 14px', borderRadius: 10,
                            background: 'rgba(16,16,20,0.92)',
                            border: '1px solid rgba(255,255,255,0.14)',
                            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
                            color: '#fff'
                        }}
                    >
                        <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                            {t('upNext').replace('{n}', secondsLeft(upNext.deadline, Date.now()))}
                        </div>
                        <div
                            style={{
                                margin: '6px 0 10px', fontSize: 13, fontWeight: 600, lineHeight: 1.35,
                                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                            }}
                            title={upNext.target}
                        >
                            {upNext.target.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={() => setUpNext(u => (u ? { ...u, deadline: 0 } : null))}
                                style={{
                                    flex: 1, padding: '7px 10px', borderRadius: 7, border: 'none',
                                    background: '#fff', color: '#111', fontSize: 12, fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                {t('playNow')}
                            </button>
                            <button
                                onClick={() => setUpNext(null)}
                                style={{
                                    padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
                                    border: '1px solid rgba(255,255,255,0.22)',
                                    background: 'transparent', color: '#fff', fontSize: 12
                                }}
                            >
                                {t('cancel')}
                            </button>
                        </div>
                    </div>
                )}

                {episodesOpen && (
                    <EpisodePicker
                        files={files}
                        currentIndex={currentIndex}
                        onPick={(i) => onSelectVideo?.(i)}
                        onClose={() => setEpisodesOpen(false)}
                    />
                )}

                {styleOpen && (
                    <div style={{ position: 'absolute', bottom: 64, right: 12, zIndex: 6 }}>
                        <SubtitleSettings
                            ccMode={ccMode}
                            onCcMode={pickCc}
                            style={subStyle}
                            onChange={setSubStyle}
                            onClose={() => setStyleOpen(false)}
                            onRetranscribe={retranscribe}
                            onExportSrt={exportSrt}
                            difficulty={difficulty}
                            onDifficultyChange={(next) => { writeDifficulty(next); setDifficulty(next); }}
                            knownCount={knownWords.size}
                            onForgetKnown={() => setKnownWords(clearKnownWords())}
                        />
                    </div>
                )}

                {/* Your turn to speak — shown where the eyes already are. */}
                {shadowWait > 0 && (
                    <div style={{
                        position: 'absolute', left: '50%', top: '50%', zIndex: 6,
                        transform: 'translate(-50%,-50%)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        padding: '14px 26px', borderRadius: 14,
                        background: 'rgba(0,0,0,0.55)', color: '#fff',
                        backdropFilter: 'blur(3px)', pointerEvents: 'none'
                    }}>
                        <span style={{ fontSize: 13, opacity: 0.85 }}>{t('shadowYourTurn')}</span>
                        <span style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {shadowWait}
                        </span>
                    </div>
                )}

                {/* Bottom-left: resume prompt + A-B loop pill */}
                <div style={{
                    position: 'absolute', left: 12, bottom: 76, zIndex: 5,
                    display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start'
                }}>
                    {resumePrompt && (
                        <button
                            onClick={() => { seekTo(resumePrompt.time); setResumePrompt(null); }}
                            style={{ ...pill, cursor: 'pointer' }}
                        >
                            {t('resumeAt')} {fmtTime(resumePrompt.time)}
                        </button>
                    )}
                    {abLoop && (
                        <button
                            title={t('abLoopHint')}
                            onClick={() => setAbLoop(null)}
                            style={{ ...pill, cursor: 'pointer' }}
                        >
                            A {fmtTime(abLoop.a)}
                            {abLoop.b != null ? ` – B ${fmtTime(abLoop.b)}` : ` – B ?`}
                            {' ✕'}
                        </button>
                    )}
                </div>

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
                        <button onClick={() => { toggleAutoSubs(); }} style={menuItem}>
                            <span>{t('ctxAutoSubs')}</span>
                            <span style={{ opacity: 0.7 }}>{autoSubs ? '✓' : ''}</span>
                        </button>
                        <button onClick={() => { toggleGlow(); }} style={menuItem}>
                            <span>{t('ctxGlow')}</span>
                            <span style={{ opacity: 0.7 }}>{glowOn ? '✓' : ''}</span>
                        </button>
                        <button onClick={() => { enterPip(); setMenu(null); }} style={menuItem}>
                            <span>{t('ctxPictureInPicture')}</span>
                        </button>
                    </div>
                )}
            </div>

            {wordCard && (
                <WordCard
                    word={wordCard.word}
                    example={wordCard.example}
                    anchor={wordCard.anchor}
                    onClose={() => setWordCard(null)}
                    onKnown={() => setKnownWords(readKnownWords())}
                />
            )}

            {wordbookOpen && (
                <WordbookPanel
                    onClose={() => setWordbookOpen(false)}
                    onSeekToExample={(example) => {
                        // Jump back to where the word was met, if it came from
                        // the video currently open.
                        const hit = cuesRef.current.find(c => c.text === example);
                        if (hit) seekTo(hit.start + subShiftRef.current);
                    }}
                />
            )}

            {/* Transcript / language-learning panel */}
            {transcriptOpen && !wordbookOpen && (
                <TranscriptPanel
                    cues={cues}
                    activeIndex={activeCueIndex}
                    onSeekTo={seekTo}
                    onClose={toggleTranscript}
                    transcribing={transcribing}
                    loopCueIndex={loopCueIndex}
                    onLoopCue={startCueDrill}
                    difficultMarks={difficultMarks}
                    onWordClick={openWordCard}
                    showRepeat={learnMode}
                    onEditCue={editMode ? editCue : null}
                    onCutSelection={editMode ? cutSelection : null}
                    onExportReel={editMode ? exportReel : null}
                    onExport={learnMode ? onExportStudy : null}
                />
            )}
        </div>
    );
};

const pill = {
    padding: '5px 12px', borderRadius: 999, fontSize: 12,
    background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)',
    whiteSpace: 'nowrap'
};
const iconBtn = (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 28, borderRadius: 6, cursor: 'pointer',
    background: active ? 'rgba(59,130,246,0.85)' : 'rgba(0,0,0,0.55)',
    color: '#fff', border: '1px solid rgba(255,255,255,0.15)'
});
// Inside Plyr's bar the controls are already on a dark scrim, so they drop
// the chip background and read as part of the player's own row.
const barBtn = (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    height: 26, padding: '0 7px', borderRadius: 4, cursor: 'pointer',
    fontSize: 11, fontWeight: 600, lineHeight: 1,
    background: active ? 'rgba(59,130,246,0.9)' : 'transparent',
    color: '#fff', opacity: active ? 1 : 0.85
});
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

export default VideoViewer;
