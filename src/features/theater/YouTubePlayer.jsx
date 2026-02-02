import { useMemo } from 'react';
import { extractYouTubeVideoId } from '../../utils/youtubeUrl';
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer';
import { useI18n } from '../../i18n.jsx';

const CONTAINER_ID = 'revid-yt-player';

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
  className = ''
}) => {
  const { t } = useI18n();

  const videoId = useMemo(() => extractYouTubeVideoId(url), [url]);

  const {
    status,
    isRateClamped,
    errorCode
  } = useYouTubePlayer({
    containerId: CONTAINER_ID,
    videoId,
    playbackRate,
    startAt,
    onVideoDetected,
    onVideoState
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
