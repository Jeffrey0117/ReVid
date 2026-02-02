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
  const [focusMode, setFocusMode] = useState(false);
  const [resumeToast, setResumeToast] = useState(null);
  const seekedRef = useRef(false);

  // Inject video detector script when webview is ready
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDomReady = () => {
      setIsLoading(false);
      // Inject video detector
      const script = getVideoDetectorScript();
      webview.executeJavaScript(script).catch(() => {
        // Script injection may fail on some pages
      });
    };

    const handleLoadStart = () => {
      setIsLoading(true);
      setVideoFound(false);
      seekedRef.current = false;
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleLoadStart);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleLoadStart);
    };
  }, [url]);

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
    webview.executeJavaScript(
      `window.__toggleFocusMode && window.__toggleFocusMode(${newMode})`
    ).catch(() => {});
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
