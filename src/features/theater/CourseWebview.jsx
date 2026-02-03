import { useRef, useEffect, useState, useCallback } from 'react';
import { getVideoDetectorScript } from '../../utils/webviewVideoDetector';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';

/**
 * CourseWebview — renders a <webview> for a course URL with video detection.
 * When video src is detected, switches to native player mode with playlist.
 *
 * Props:
 *   url            - course URL to load
 *   platform       - platform id for session partitioning
 *   playbackRate   - current playback speed
 *   startAt        - seconds to resume from (auto-seek on video detect)
 *   onVideoDetected - callback({ duration, src })
 *   onVideoState   - callback({ currentTime, duration, paused, playbackRate })
 *   className      - additional CSS classes
 *   playlist       - array of courses in same folder for playlist display
 *   currentCourseId - current course id for playlist highlighting
 *   onPlaylistSelect - callback when user selects from playlist
 */
export const CourseWebview = ({
  url,
  platform = 'custom',
  playbackRate = 1,
  startAt = 0,
  onVideoDetected,
  onVideoState,
  className = '',
  playlist = [],
  currentCourseId = null,
  onPlaylistSelect
}) => {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();
  const webviewRef = useRef(null);
  const nativeVideoRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [videoFound, setVideoFound] = useState(false);
  const [videoSrc, setVideoSrc] = useState(null); // If set, use native player
  const [focusMode, setFocusMode] = useState(false);
  const [resumeToast, setResumeToast] = useState(null);
  const seekedRef = useRef(false);
  const autoFocusedRef = useRef(false);

  // Inject video detector script and CSS when webview is ready
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDomReady = () => {
      setIsLoading(false);

      // Define focus mode functions (will be called when user toggles)
      const defineFocusFunctions = `
        (function() {
          window.__revidEnterFocus = function() {
            var video = document.querySelector('video');
            if (!video) return false;

            // Store original styles
            window.__revidOriginalStyles = [];
            var all = document.body.querySelectorAll('*');
            for (var i = 0; i < all.length; i++) {
              var el = all[i];
              if (el.tagName !== 'VIDEO' && !el.contains(video) && el !== video) {
                window.__revidOriginalStyles.push({ el: el, display: el.style.display });
                el.style.setProperty('display', 'none', 'important');
              }
            }

            // Store video original styles
            window.__revidVideoOriginal = {
              position: video.style.position,
              top: video.style.top,
              left: video.style.left,
              width: video.style.width,
              height: video.style.height,
              zIndex: video.style.zIndex,
              objectFit: video.style.objectFit,
              background: video.style.background
            };

            // Fullscreen video
            video.style.setProperty('position', 'fixed', 'important');
            video.style.setProperty('top', '0', 'important');
            video.style.setProperty('left', '0', 'important');
            video.style.setProperty('width', '100vw', 'important');
            video.style.setProperty('height', '100vh', 'important');
            video.style.setProperty('z-index', '2147483647', 'important');
            video.style.setProperty('object-fit', 'contain', 'important');
            video.style.setProperty('background', '#000', 'important');

            document.body.style.setProperty('overflow', 'hidden', 'important');
            return true;
          };

          window.__revidExitFocus = function() {
            // Restore hidden elements
            if (window.__revidOriginalStyles) {
              for (var i = 0; i < window.__revidOriginalStyles.length; i++) {
                var item = window.__revidOriginalStyles[i];
                item.el.style.display = item.display || '';
              }
              window.__revidOriginalStyles = null;
            }

            // Restore video styles
            var video = document.querySelector('video');
            if (video && window.__revidVideoOriginal) {
              video.style.position = window.__revidVideoOriginal.position || '';
              video.style.top = window.__revidVideoOriginal.top || '';
              video.style.left = window.__revidVideoOriginal.left || '';
              video.style.width = window.__revidVideoOriginal.width || '';
              video.style.height = window.__revidVideoOriginal.height || '';
              video.style.zIndex = window.__revidVideoOriginal.zIndex || '';
              video.style.objectFit = window.__revidVideoOriginal.objectFit || '';
              video.style.background = window.__revidVideoOriginal.background || '';
              window.__revidVideoOriginal = null;
            }

            document.body.style.overflow = '';
          };
        })();
      `;
      webview.executeJavaScript(defineFocusFunctions).catch(() => {});

      // Inject video detector script
      const script = getVideoDetectorScript();
      webview.executeJavaScript(script).catch(() => {});

      // Simple video check - poll for video element and get src
      const checkVideo = `
        (function() {
          var v = document.querySelector('video');
          if (v) {
            var src = v.src || v.currentSrc || '';
            // Also check for source elements
            if (!src) {
              var source = v.querySelector('source');
              if (source) src = source.src || '';
            }
            return { found: true, duration: v.duration || 0, src: src };
          }
          return { found: false };
        })();
      `;

      // Poll for video
      const pollVideo = () => {
        webview.executeJavaScript(checkVideo).then((result) => {
          if (result && result.found) {
            setVideoFound(true);
            onVideoDetected?.({ duration: result.duration, src: result.src });

            // If we got a valid video src (not blob:), switch to native player
            const canUseNative = result.src &&
              !result.src.startsWith('blob:') &&
              (result.src.includes('.mp4') || result.src.includes('.m3u8') || result.src.includes('.webm'));

            if (canUseNative) {
              setVideoSrc(result.src);
            } else if (!autoFocusedRef.current) {
              // Can't use native player, auto-enable focus mode in webview
              autoFocusedRef.current = true;
              setFocusMode(true);
              webview.executeJavaScript('window.__revidEnterFocus && window.__revidEnterFocus()').catch(() => {});
            }
          }
        }).catch(() => {});
      };

      // Check immediately and every 2 seconds
      pollVideo();
      const pollInterval = setInterval(pollVideo, 2000);

      // Store interval for cleanup
      webview._revidPollInterval = pollInterval;
    };

    const handleLoadStart = () => {
      setIsLoading(true);
      setVideoFound(false);
      setVideoSrc(null);
      seekedRef.current = false;
      autoFocusedRef.current = false;
      // Clear poll interval
      if (webview._revidPollInterval) {
        clearInterval(webview._revidPollInterval);
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleLoadStart);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleLoadStart);
      if (webview._revidPollInterval) {
        clearInterval(webview._revidPollInterval);
      }
    };
  }, [url, onVideoDetected]);

  // Listen for messages from injected script
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleMessage = (event) => {
      const { channel, args } = event;
      if (channel === 'console-message') return;

      // Messages come through ipc-message for webview
    };

    // Use window message listener for postMessage from webview
    const handleWindowMessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'revid-video-detected') {
        setVideoFound(true);
        onVideoDetected?.({
          duration: data.duration,
          src: data.src
        });

        // Auto-seek to last position
        if (startAt > 0 && !seekedRef.current) {
          seekedRef.current = true;
          const webview = webviewRef.current;
          if (webview) {
            setTimeout(() => {
              webview.executeJavaScript(`
                (function() {
                  var v = document.querySelector('video');
                  if (v && v.duration > 0) v.currentTime = ${startAt};
                })();
              `).catch(function() {});
            }, 1500);

            const mins = Math.floor(startAt / 60);
            const secs = Math.floor(startAt % 60);
            const timeStr = mins > 0
              ? mins + ':' + String(secs).padStart(2, '0')
              : secs + 's';
            setResumeToast(timeStr);
            setTimeout(() => setResumeToast(null), 3000);
          }
        }
      }

      if (data.type === 'revid-video-state') {
        onVideoState?.({
          currentTime: data.currentTime,
          duration: data.duration,
          paused: data.paused,
          playbackRate: data.playbackRate
        });
      }
    };

    // For webview, use ipc-message event
    const handleIpcMessage = (event) => {
      // Handle console messages from webview
    };

    webview.addEventListener('ipc-message', handleIpcMessage);
    window.addEventListener('message', handleWindowMessage);

    return () => {
      webview.removeEventListener('ipc-message', handleIpcMessage);
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [onVideoDetected, onVideoState, startAt]);

  // Update playback rate when prop changes
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !videoFound) return;

    webview.executeJavaScript(
      `window.__setPlaybackRate && window.__setPlaybackRate(${playbackRate})`
    ).catch(() => {});
  }, [playbackRate, videoFound]);

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview || !videoFound) return;

    const newMode = !focusMode;
    setFocusMode(newMode);

    if (newMode) {
      webview.executeJavaScript('window.__revidEnterFocus && window.__revidEnterFocus()').catch(() => {});
    } else {
      webview.executeJavaScript('window.__revidExitFocus && window.__revidExitFocus()').catch(() => {});
    }
  }, [focusMode, videoFound]);

  const partition = `persist:theater-${platform}`;

  // Handle native video time updates
  useEffect(() => {
    const video = nativeVideoRef.current;
    if (!video || !videoSrc) return;

    const handleTimeUpdate = () => {
      onVideoState?.({
        currentTime: video.currentTime,
        duration: video.duration || 0,
        paused: video.paused,
        playbackRate: video.playbackRate
      });
    };

    const handleLoadedMetadata = () => {
      onVideoDetected?.({ duration: video.duration, src: videoSrc });
      // Auto-seek
      if (startAt > 0 && !seekedRef.current) {
        seekedRef.current = true;
        video.currentTime = startAt;
        const mins = Math.floor(startAt / 60);
        const secs = Math.floor(startAt % 60);
        const timeStr = mins > 0 ? mins + ':' + String(secs).padStart(2, '0') : secs + 's';
        setResumeToast(timeStr);
        setTimeout(() => setResumeToast(null), 3000);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('pause', handleTimeUpdate);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('pause', handleTimeUpdate);
    };
  }, [videoSrc, startAt, onVideoState, onVideoDetected]);

  // Update native video playback rate
  useEffect(() => {
    const video = nativeVideoRef.current;
    if (video && videoSrc) {
      video.playbackRate = playbackRate;
    }
  }, [playbackRate, videoSrc]);

  // Native player mode
  if (videoSrc && !videoSrc.startsWith('blob:')) {
    return (
      <div className={`relative flex ${className}`} style={{ background: '#000' }}>
        {/* Video player */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <video
            ref={nativeVideoRef}
            src={videoSrc}
            controls
            autoPlay
            style={{ flex: 1, width: '100%', background: '#000', objectFit: 'contain' }}
          />

          {/* Resume toast */}
          {resumeToast && (
            <div style={{
              position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
              padding: '6px 16px', borderRadius: 8,
              background: 'rgba(0,0,0,0.85)', color: '#fff',
              fontSize: 13, zIndex: 20, whiteSpace: 'nowrap'
            }}>
              {t('resumedAt')} {resumeToast}
            </div>
          )}
        </div>

        {/* Playlist sidebar */}
        {playlist.length > 1 && (
          <div style={{
            width: 240, flexShrink: 0,
            background: isDark ? '#111' : '#f5f5f5',
            borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            overflowY: 'auto', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{
              padding: '10px 12px',
              fontSize: 12, fontWeight: 600,
              color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
              borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`
            }}>
              {t('playlist')} ({playlist.length})
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {playlist.map((course, index) => {
                const isActive = course.id === currentCourseId;
                const progress = course.progress?.duration > 0
                  ? Math.round((course.progress.lastPosition / course.progress.duration) * 100)
                  : 0;
                return (
                  <div
                    key={course.id}
                    onClick={() => onPlaylistSelect?.(course.id)}
                    style={{
                      padding: '8px 12px', cursor: 'pointer',
                      background: isActive ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.15)') : 'transparent',
                      borderLeft: isActive ? `3px solid ${theme.accent}` : '3px solid transparent',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)', minWidth: 20 }}>
                        {index + 1}
                      </span>
                      <span style={{
                        fontSize: 12, flex: 1,
                        color: isActive ? theme.accent : (isDark ? '#fff' : '#1f2937'),
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                      }}>
                        {course.title}
                      </span>
                    </div>
                    {progress > 0 && (
                      <div style={{
                        marginTop: 4, marginLeft: 28, height: 2, borderRadius: 1,
                        background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                      }}>
                        <div style={{ height: '100%', borderRadius: 1, background: theme.accent, width: `${progress}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Webview mode (fallback)
  return (
    <div className={`relative flex flex-col ${className}`}>
      {/* Webview */}
      <webview
        ref={webviewRef}
        src={url}
        partition={partition}
        className="flex-1 w-full"
        style={{ minHeight: 0 }}
        allowpopups="true"
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/30 border-t-primary rounded-full animate-spin" />
            <span className="text-white/60 text-sm">{t('detectingVideo')}</span>
          </div>
        </div>
      )}

      {/* Resume toast */}
      {resumeToast && (
        <div style={{
          position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
          padding: '6px 16px', borderRadius: 8,
          background: 'rgba(0,0,0,0.85)', color: '#fff',
          fontSize: 13, zIndex: 20, whiteSpace: 'nowrap'
        }}>
          {t('resumedAt')} {resumeToast}
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface/50 border-t border-white/5 text-xs">
        {/* Video detection indicator */}
        <div className={`w-2 h-2 rounded-full ${videoFound ? 'bg-green-500' : 'bg-white/20'}`} />
        <span className="text-white/50">
          {videoFound ? t('videoDetected') : t('detectingVideo')}
        </span>

        <div className="flex-1" />

        {/* Focus mode toggle */}
        {videoFound && (
          <button
            onClick={toggleFocusMode}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              focusMode
                ? 'bg-primary/20 text-primary'
                : 'bg-white/5 text-white/40 hover:bg-white/10'
            }`}
          >
            {t('focusMode')}
          </button>
        )}

        {/* Speed indicator */}
        <span className="text-white/30">{playbackRate}x</span>
      </div>
    </div>
  );
};
