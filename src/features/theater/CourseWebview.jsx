import { useRef, useEffect, useState, useCallback } from 'react';
import { getVideoDetectorScript } from '../../utils/webviewVideoDetector';
import { useI18n } from '../../i18n.jsx';

/**
 * CourseWebview — renders a <webview> for a course URL with video detection.
 *
 * Props:
 *   url            - course URL to load
 *   platform       - platform id for session partitioning
 *   playbackRate   - current playback speed
 *   startAt        - seconds to resume from (auto-seek on video detect)
 *   onVideoDetected - callback({ duration, src })
 *   onVideoState   - callback({ currentTime, duration, paused, playbackRate })
 *   className      - additional CSS classes
 */
export const CourseWebview = ({
  url,
  platform = 'custom',
  playbackRate = 1,
  startAt = 0,
  onVideoDetected,
  onVideoState,
  className = ''
}) => {
  const { t } = useI18n();
  const webviewRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [videoFound, setVideoFound] = useState(false);
  const [focusMode, setFocusMode] = useState(false); // User can toggle to fullscreen
  const [resumeToast, setResumeToast] = useState(null);
  const seekedRef = useRef(false);

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

      // Simple video check - poll for video element
      const checkVideo = `
        (function() {
          var v = document.querySelector('video');
          if (v) {
            return { found: true, duration: v.duration || 0, src: v.src || v.currentSrc || '' };
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
      seekedRef.current = false;
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
