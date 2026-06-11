import { useMemo } from 'react';
import { extractYouTubeVideoId } from '../../utils/youtubeUrl';
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer';
import { useI18n } from '../../i18n.jsx';

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
  onNext,
  onPrev,
  className = '',
  musicMode = false,
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
    togglePlay
  } = useYouTubePlayer({
    containerId: CONTAINER_ID,
    videoId,
    playbackRate,
    startAt,
    onVideoDetected,
    onVideoState,
    onEnded
  });

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

        {/* Music-album overlay — one cover over the (still-playing) video,
            current song title and prev / play-pause / next controls. */}
        {musicMode && status !== 'error' && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'radial-gradient(circle at 50% 35%, #2a2a32 0%, #0a0a0c 70%)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 22, padding: 24
          }}>
            <div style={{
              width: 'min(46vh, 340px)', aspectRatio: '1 / 1',
              borderRadius: 16, overflow: 'hidden', background: '#1a1a1a',
              boxShadow: '0 16px 48px rgba(0,0,0,0.6)'
            }}>
              {cover ? (
                <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <button onClick={onPrev} title="Prev" style={musicBtn}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
              </button>
              <button onClick={togglePlay} title="Play/Pause" style={{ ...musicBtn, width: 64, height: 64, background: '#fff', color: '#111' }}>
                {paused ? (
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
                )}
              </button>
              <button onClick={onNext} title="Next" style={musicBtn}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-2.5 6L5 6v12z" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar
        status={status}
        isRateClamped={isRateClamped}
        playbackRate={playbackRate}
        t={t}
      />
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
