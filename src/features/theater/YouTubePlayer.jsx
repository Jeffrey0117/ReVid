import { useMemo, useState, useEffect } from 'react';
import { extractYouTubeVideoId } from '../../utils/youtubeUrl';
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer';
import { useI18n } from '../../i18n.jsx';

const COVER_STEPS = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'];
const iconBtn = {
  width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'rgba(255,255,255,0.12)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
};

const CONTAINER_ID = 'revid-yt-player';

const musicBtn = {
  width: 48, height: 48, borderRadius: '50%', border: 'none', cursor: 'pointer',
  background: 'rgba(255,255,255,0.12)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
};

/**
 * YouTubePlayer - renders a YouTube IFrame player for a course URL.
 *
 * Props interface matches CourseWebview:
 *   url             - YouTube video URL
 *   playbackRate    - desired speed (1-3)
 *   startAt         - seconds to resume from
 *   onVideoDetected - ({ duration, src }) when player is ready
 *   onVideoState    - ({ currentTime, duration, paused, playbackRate }) every 1 s
 *   className       - additional CSS classes
 */
export const YouTubePlayer = ({
  url,
  playbackRate = 1,
  startAt = 0,
  onVideoDetected,
  onVideoState,
  onEnded,
  onTitle,
  onNext,
  onPrev,
  onToggleMinimize,
  onClose,
  className = '',
  musicMode = false,
  minimized = false,
  cover = null,
  title = '',
  trackLabel = ''
}) => {
  const { t } = useI18n();

  const videoId = useMemo(() => extractYouTubeVideoId(url), [url]);

  const {
    status,
    isRateClamped,
    errorCode,
    paused,
    currentTime,
    duration,
    seekTo,
    togglePlay
  } = useYouTubePlayer({
    containerId: CONTAINER_ID,
    videoId,
    playbackRate,
    startAt,
    onVideoDetected,
    onVideoState,
    onEnded,
    onTitle
  });

  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Resolve the cover once per video (step down only on real 404s) so the
  // 1s state updates don't re-trigger maxres → flicker.
  const [coverIdx, setCoverIdx] = useState(0);
  useEffect(() => { setCoverIdx(0); }, [videoId, cover]);
  const coverSrc = cover || (videoId ? `https://img.youtube.com/vi/${videoId}/${COVER_STEPS[coverIdx]}.jpg` : null);
  const onCoverError = () => { if (!cover) setCoverIdx((i) => Math.min(i + 1, COVER_STEPS.length - 1)); };
  const seekFromEvent = (e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  };
  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  // Invalid URL - no video ID found
  if (!videoId) {
    return (
      <div className={`relative flex flex-col ${className}`}>
        <div className="flex-1 min-h-0 bg-black flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-red-400 text-xl font-bold">!</span>
            </div>
            <span className="text-white/60 text-sm">{t('ytInvalidUrl')}</span>
            <span className="text-white/30 text-xs max-w-xs text-center truncate">{url}</span>
          </div>
        </div>
        <StatusBar status="error" isRateClamped={false} playbackRate={playbackRate} t={t} />
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col ${className}`}>
      {/* Player container */}
      <div className="flex-1 min-h-0 bg-black relative">
        <div
          id={CONTAINER_ID}
          className="w-full h-full"
        />

        {/* Loading overlay */}
        {status === 'loading' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-white/30 border-t-red-500 rounded-full animate-spin" />
              <span className="text-white/60 text-sm">{t('ytLoading')}</span>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {status === 'error' && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-xl font-bold">!</span>
              </div>
              <span className="text-white/60 text-sm">{t('ytError')}</span>
              {errorCode != null && (
                <span className="text-white/30 text-xs">Code: {errorCode}</span>
              )}
            </div>
          </div>
        )}

        {/* Music-album overlay over the (still-playing) video. */}
        {musicMode && status !== 'error' && (minimized ? (
          /* ---- Minimized: flat wide bar (browse while it plays) ---- */
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20, background: '#16161a',
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px'
          }}>
            <div style={{ width: 78, height: 78, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#000' }}>
              {coverSrc && <img src={coverSrc} onError={onCoverError} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || t('ytLoading')}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{trackLabel}</div>
              <div onClick={seekFromEvent} style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', cursor: 'pointer', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: '#fff', borderRadius: 2 }} />
              </div>
            </div>
            <button onClick={onPrev} title="Prev" style={{ ...musicBtn, width: 30, height: 30 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
            </button>
            <button onClick={togglePlay} title="Play/Pause" style={{ ...musicBtn, width: 38, height: 38, background: '#fff', color: '#111' }}>
              {paused
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>}
            </button>
            <button onClick={onNext} title="Next" style={{ ...musicBtn, width: 30, height: 30 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-2.5 6L5 6v12z" /></svg>
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={onToggleMinimize} title="Expand" style={{ ...iconBtn, width: 24, height: 24 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m18 15-6-6-6 6" /></svg>
              </button>
              <button onClick={onClose} title="Close" style={{ ...iconBtn, width: 24, height: 24 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        ) : (
          /* ---- Full album ---- */
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'radial-gradient(circle at 50% 35%, #2a2a32 0%, #0a0a0c 70%)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 22, padding: 24
          }}>
            <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 8, zIndex: 2 }}>
              <button onClick={onToggleMinimize} title="Minimize" style={iconBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14" /></svg>
              </button>
              <button onClick={onClose} title="Close" style={iconBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div style={{
              width: 'min(46vh, 340px)', aspectRatio: '1 / 1',
              borderRadius: 16, overflow: 'hidden', background: '#1a1a1a',
              boxShadow: '0 16px 48px rgba(0,0,0,0.6)'
            }}>
              {coverSrc ? (
                <img src={coverSrc} onError={onCoverError} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', maxWidth: 'min(80%, 480px)' }}>
              <div style={{
                color: '#fff', fontSize: 18, fontWeight: 600, lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
              }}>{title || t('ytLoading')}</div>
              {trackLabel && (
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 6 }}>{trackLabel}</div>
              )}
            </div>

            <div style={{ width: 'min(80%, 460px)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>{fmt(currentTime)}</span>
              <div onClick={seekFromEvent} style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.18)', cursor: 'pointer', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, width: `${pct}%`, background: '#fff' }} />
              </div>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>{fmt(duration)}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <button onClick={onPrev} title="Prev" style={musicBtn}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
              </button>
              <button onClick={togglePlay} title="Play/Pause" style={{ ...musicBtn, width: 64, height: 64, background: '#fff', color: '#111' }}>
                {paused
                  ? <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  : <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>}
              </button>
              <button onClick={onNext} title="Next" style={musicBtn}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-2.5 6L5 6v12z" /></svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Status bar (hidden in music mode for a clean look) */}
      {!musicMode && (
        <StatusBar
          status={status}
          isRateClamped={isRateClamped}
          playbackRate={playbackRate}
          t={t}
        />
      )}
    </div>
  );
};

/**
 * Shared status bar at the bottom of the player.
 */
const StatusBar = ({ status, isRateClamped, playbackRate, t }) => {
  const statusLabel = status === 'ready'
    ? t('ytConnected')
    : status === 'error'
      ? t('ytError')
      : t('ytConnecting');

  const dotColor = status === 'ready'
    ? 'bg-green-500'
    : status === 'error'
      ? 'bg-red-500'
      : 'bg-white/20';

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-black/50 border-t border-white/5 text-xs">
      {/* YouTube badge */}
      <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold bg-red-600 text-white">
        Y
      </span>

      {/* Connection status */}
      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span className="text-white/50">{statusLabel}</span>

      <div className="flex-1" />

      {/* Speed clamp warning */}
      {isRateClamped && (
        <span className="text-amber-400 text-[10px] font-medium">
          {t('ytMaxSpeed')}
        </span>
      )}

      {/* Speed indicator */}
      <span className="text-white/30">
        {Math.min(playbackRate, 2)}x
      </span>
    </div>
  );
};
