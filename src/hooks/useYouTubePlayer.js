import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * YouTube IFrame Player API lifecycle management hook.
 *
 * Loads the IFrame API script (idempotent), creates / destroys a YT.Player
 * instance, reports playback state every 1 s, and handles speed clamping
 * (YouTube caps at 2x).
 *
 * Options:
 *   containerId   - DOM id for the player div
 *   videoId       - 11-char YouTube video ID
 *   playbackRate  - desired speed (1-3)
 *   startAt       - seconds to resume from
 *   onVideoDetected - ({ duration, src }) when player is ready
 *   onVideoState  - ({ currentTime, duration, paused, playbackRate }) every 1 s
 *   onError       - (errorCode) when player errors
 */

const YT_MAX_RATE = 2;
const REPORT_INTERVAL_MS = 1000;

// Module-level promise so the script is only loaded once across all instances.
let apiLoadPromise = null;

const loadYouTubeApi = () => {
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    // If already loaded
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    // The API calls this global callback when ready
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });

  return apiLoadPromise;
};

export const useYouTubePlayer = ({
  containerId,
  videoId,
  playbackRate = 1,
  startAt = 0,
  onVideoDetected,
  onVideoState,
  onError
}) => {
  const playerRef = useRef(null);
  const intervalRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [effectiveRate, setEffectiveRate] = useState(playbackRate);
  const [errorCode, setErrorCode] = useState(null);

  // Clamp rate to YouTube's maximum
  const clampedRate = Math.min(playbackRate, YT_MAX_RATE);
  const isRateClamped = playbackRate > YT_MAX_RATE;

  // --- Create / destroy player ---
  useEffect(() => {
    if (!videoId || !containerId) return;

    let destroyed = false;

    const init = async () => {
      try {
        const YT = await loadYouTubeApi();
        if (destroyed) return;

        const player = new YT.Player(containerId, {
          videoId,
          playerVars: {
            autoplay: 1,
            start: Math.floor(startAt),
            rel: 0,
            modestbranding: 1,
            playsinline: 1
          },
          events: {
            onReady: (event) => {
              if (destroyed) return;
              setStatus('ready');

              const duration = event.target.getDuration() || 0;
              event.target.setPlaybackRate(clampedRate);
              setEffectiveRate(clampedRate);

              onVideoDetected?.({
                duration,
                src: `https://www.youtube.com/watch?v=${videoId}`
              });

              // Start state reporting interval
              intervalRef.current = setInterval(() => {
                if (destroyed) return;
                try {
                  const currentTime = event.target.getCurrentTime() || 0;
                  const dur = event.target.getDuration() || 0;
                  const state = event.target.getPlayerState();
                  const rate = event.target.getPlaybackRate() || 1;

                  // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
                  const paused = state !== 1;

                  onVideoState?.({
                    currentTime,
                    duration: dur,
                    paused,
                    playbackRate: rate
                  });
                } catch {
                  // Player may be destroyed between ticks
                }
              }, REPORT_INTERVAL_MS);
            },
            onError: (event) => {
              if (destroyed) return;
              setStatus('error');
              setErrorCode(event.data);
              onError?.(event.data);
            },
            onStateChange: () => {
              // Intentionally empty - state is polled via interval
            }
          }
        });

        playerRef.current = player;
      } catch {
        if (!destroyed) {
          setStatus('error');
          setErrorCode(-1);
        }
      }
    };

    setStatus('loading');
    setErrorCode(null);
    init();

    return () => {
      destroyed = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      try {
        playerRef.current?.destroy();
      } catch {
        // Ignore if already disposed
      }
      playerRef.current = null;
    };
    // We intentionally only re-create the player when videoId or containerId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, containerId]);

  // --- Sync playback rate (without recreating the player) ---
  useEffect(() => {
    const player = playerRef.current;
    if (!player || status !== 'ready') return;

    try {
      player.setPlaybackRate(clampedRate);
      setEffectiveRate(clampedRate);
    } catch {
      // Player may not be ready yet
    }
  }, [clampedRate, status]);

  // --- Seek ---
  const seekTo = useCallback((seconds) => {
    const player = playerRef.current;
    if (!player || status !== 'ready') return;
    try {
      player.seekTo(seconds, true);
    } catch {
      // Ignore
    }
  }, [status]);

  return {
    status,
    effectiveRate,
    isRateClamped,
    errorCode,
    seekTo
  };
};
