import { useEffect, useRef, useState, useCallback } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { getCachedThumbnail } from '../../utils/videoThumbnails';
import { parseSubtitles, findActiveCueIndex } from '../../utils/subtitles';
import { TranscriptPanel } from './TranscriptPanel';
import { WordbookPanel } from './WordbookPanel';
import { BookMarked, Lock } from '../../components/icons';
import { hasFeature, FEATURES } from '../licensing/entitlements';
import { SubtitleSettings, readSubtitleStyle, subtitleTextStyle } from './SubtitleSettings';
import {
    WordCard, ClickableText, readDifficulty, writeDifficulty, readKnownWords, clearKnownWords
} from './WordLookup';
import { Captions, PanelRight, Sliders } from '../../components/icons';
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

export const VideoViewer = ({ src, videoPath, timeRef, onExportStudy, onUpgrade }) => {
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

        // Merge any previously translated sidecar onto the source cues so a
        // video is never re-translated.
        const withTranslations = (base) => {
            const zh = api.readTranslatedSubtitles?.(videoPath);
            if (!zh) return base;
            const zhCues = parseSubtitles(zh.content, 'srt');
            if (zhCues.length !== base.length) return base; // misaligned sidecar
            return base.map((c, i) => ({ ...c, zh: zhCues[i].text }));
        };

        const sub = api.readSubtitles(videoPath);
        if (sub) {
            setCues(withTranslations(parseSubtitles(sub.content, sub.format)));
            return;
        }
        if (!autoSubsRef.current) return;

        let cancelled = false;
        let live = [];
        (async () => {
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
                const finished = api.readSubtitles(videoPath);
                if (finished) setCues(withTranslations(parseSubtitles(finished.content, finished.format)));
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

    const cycleCc = useCallback(() => {
        setCcMode(prev => {
            const next = CC_MODES[(CC_MODES.indexOf(prev) + 1) % CC_MODES.length];
            localStorage.setItem(CC_KEY, next);
            return next;
        });
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
    const CC_LABEL = { both: '中/EN', orig: 'EN', zh: '中', off: 'off' };

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
                {ccMode !== 'off' && activeCue && (showOrig || showZh) && (
                    <div style={{
                        position: 'absolute', left: '50%', zIndex: 4,
                        [subStyle.position]: subStyle.offset,
                        transform: 'translateX(-50%)',
                        maxWidth: '82%', padding: '7px 16px',
                        background: `rgba(0,0,0,${subStyle.bgOpacity})`,
                        borderRadius: 8,
                        textAlign: 'center', whiteSpace: 'pre-wrap',
                        pointerEvents: 'none',
                        backdropFilter: subStyle.bgOpacity > 0 ? 'blur(2px)' : 'none'
                    }}>
                        {showOrig && (
                            <div style={{
                                ...subtitleTextStyle(subStyle),
                                fontSize: subStyle.fontSize, lineHeight: 1.4,
                                pointerEvents: 'auto' // words are clickable
                            }}>
                                <ClickableText
                                    text={activeCue.text}
                                    marks={difficultMarks[activeCueIndex]}
                                    markColor={theme.pin}
                                    onWordClick={(w, e) => openWordCard(w, e, activeCue.text)}
                                />
                            </div>
                        )}
                        {showZh && activeCue.zh && (
                            <div style={{
                                ...subtitleTextStyle(subStyle),
                                opacity: showOrig ? 0.78 : 1,
                                fontSize: showOrig
                                    ? Math.round(subStyle.fontSize * 0.78)
                                    : subStyle.fontSize,
                                lineHeight: 1.4,
                                marginTop: showOrig ? 2 : 0
                            }}>
                                {activeCue.zh}
                            </div>
                        )}
                    </div>
                )}

                {/* Top-right: CC + transcript toggles, transcription status */}
                <div style={{
                    position: 'absolute', top: 12, right: 12, zIndex: 5,
                    display: 'flex', alignItems: 'center', gap: 6
                }}>
                    {transcribing && (
                        <span style={pill}>
                            {t('transcriptWaiting')} {transcribing.pct}%
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
                    <button
                        title={t('ccToggle')}
                        onClick={cycleCc}
                        style={{ ...iconBtn(ccMode !== 'off'), width: 'auto', padding: '0 8px', gap: 5 }}
                    >
                        <Captions size={16} />
                        <span style={{ fontSize: 10, fontWeight: 600 }}>{CC_LABEL[ccMode]}</span>
                    </button>
                    <button
                        title={t('subStyleTitle')}
                        onClick={(e) => { e.stopPropagation(); setStyleOpen(o => !o); }}
                        style={iconBtn(styleOpen)}
                    >
                        <Sliders size={16} />
                    </button>
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

                {styleOpen && (
                    <div style={{ position: 'absolute', top: 48, right: 12, zIndex: 6 }}>
                        <SubtitleSettings
                            style={subStyle}
                            onChange={setSubStyle}
                            onClose={() => setStyleOpen(false)}
                            onRetranscribe={retranscribe}
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
                    transcribing={Boolean(transcribing)}
                    loopCueIndex={loopCueIndex}
                    onLoopCue={startCueDrill}
                    difficultMarks={difficultMarks}
                    onWordClick={openWordCard}
                    showRepeat={learnMode}
                    onEditCue={editMode ? editCue : null}
                    onCutSelection={editMode ? cutSelection : null}
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
