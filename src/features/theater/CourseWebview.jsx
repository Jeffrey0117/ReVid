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
 *   onThumbnailCaptured - callback(thumbnailDataUrl) when thumbnail is captured
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
  onThumbnailCaptured,
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
  const [detectedVideoUrl, setDetectedVideoUrl] = useState(null); // For download (even if not using native player)
  const [resumeToast, setResumeToast] = useState(null);
  const [focusVideoState, setFocusVideoState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [downloadProgress, setDownloadProgress] = useState(null); // null | { progress, status }
  const [needsLogin, setNeedsLogin] = useState(false); // Show login hint after timeout
  const [pollCount, setPollCount] = useState(0);
  const initialLoadDoneRef = useRef(false); // Prevent reload loop from resetting overlay
  const lastUrlRef = useRef(url); // Track URL changes
  const videoFoundRef = useRef(false); // Track if video found (for timeout check)
  const seekedRef = useRef(false);

  // Reset flags when URL changes (new course selected)
  if (url !== lastUrlRef.current) {
    lastUrlRef.current = url;
    initialLoadDoneRef.current = false;
    videoFoundRef.current = false;
  }
  const focusAppliedRef = useRef(false);
  const focusStateIntervalRef = useRef(null);
  const thumbnailCapturedRef = useRef(false);

  // Inject video detector script and CSS when webview is ready
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDomReady = () => {
      // Hide loading overlay after short delay regardless of video detection
      // Only do this once to prevent redirect loops from re-showing overlay
      if (!initialLoadDoneRef.current) {
        setTimeout(() => {
          initialLoadDoneRef.current = true;
          setIsLoading(false);
          // Only show login hint if video hasn't been found yet
          if (!videoFoundRef.current) {
            setNeedsLogin(true);
          }
        }, 1500);
      }

      // Define focus mode functions (will be called when user toggles)
      const defineFocusFunctions = `
        (function() {
          // Find video in nested shadow DOMs
          function findVideoInShadow() {
            var queue = [document];
            var visited = new Set();
            while (queue.length > 0) {
              var root = queue.shift();
              if (!root || visited.has(root)) continue;
              visited.add(root);
              try {
                var videos = root.querySelectorAll ? root.querySelectorAll('video') : [];
                if (videos.length > 0) return videos[0];
                var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
                for (var i = 0; i < all.length; i++) {
                  if (all[i].shadowRoot && !visited.has(all[i].shadowRoot)) {
                    queue.push(all[i].shadowRoot);
                  }
                }
              } catch(e) {}
            }
            return null;
          }

          window.__revidEnterFocus = function() {
            var video = findVideoInShadow();
            if (!video) {
              console.log('[ReVid] Focus: No video found');
              return false;
            }
            console.log('[ReVid] Focus: Found video, applying focus mode');

            // Find the custom video player container (hls-video, video-js, etc.)
            var videoContainer = null;
            var el = video;
            while (el && el !== document.body) {
              if (el.tagName && (el.tagName.includes('-') || el.classList.contains('video-player'))) {
                videoContainer = el;
              }
              el = el.parentElement || el.host; // host for shadow DOM
            }
            if (!videoContainer) {
              // Find through shadow host chain
              var root = video.getRootNode();
              while (root && root !== document) {
                if (root.host) {
                  videoContainer = root.host;
                  root = root.host.getRootNode();
                } else break;
              }
            }

            var targetEl = videoContainer || video;
            window.__revidFocusTarget = targetEl;

            // Hide everything except the video container
            window.__revidOriginalStyles = [];
            var all = document.body.querySelectorAll('*');
            for (var i = 0; i < all.length; i++) {
              var item = all[i];
              if (item !== targetEl && !item.contains(targetEl) && !targetEl.contains(item)) {
                window.__revidOriginalStyles.push({ el: item, display: item.style.display });
                item.style.setProperty('display', 'none', 'important');
              }
            }

            // Fullscreen the video container
            var w = window.innerWidth;
            var h = window.innerHeight;
            targetEl.style.setProperty('position', 'fixed', 'important');
            targetEl.style.setProperty('top', '0px', 'important');
            targetEl.style.setProperty('left', '0px', 'important');
            targetEl.style.setProperty('width', w + 'px', 'important');
            targetEl.style.setProperty('height', h + 'px', 'important');
            targetEl.style.setProperty('max-width', 'none', 'important');
            targetEl.style.setProperty('max-height', 'none', 'important');
            targetEl.style.setProperty('z-index', '2147483647', 'important');
            targetEl.style.setProperty('background', '#000', 'important');
            targetEl.style.setProperty('margin', '0', 'important');
            targetEl.style.setProperty('padding', '0', 'important');

            // Style html and body
            document.documentElement.style.setProperty('background', '#000', 'important');
            document.documentElement.style.setProperty('overflow', 'hidden', 'important');
            document.body.style.setProperty('background', '#000', 'important');
            document.body.style.setProperty('overflow', 'hidden', 'important');
            document.body.style.setProperty('margin', '0', 'important');
            document.body.style.setProperty('padding', '0', 'important');

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

      // Comprehensive video check - find video and get real src (not blob)
      const checkVideo = `
        (function() {
          var shadowRootsFound = 0;
          var queue = [document];
          var visited = new Set();
          var foundVideo = null;
          var realSrc = '';

          // First pass: find custom video players with real src (hls-video, video-js, etc.)
          try {
            var customPlayers = document.querySelectorAll('hls-video, video-js, media-player, [data-video-src]');
            for (var i = 0; i < customPlayers.length; i++) {
              var src = customPlayers[i].getAttribute('src') || customPlayers[i].dataset.videoSrc || '';
              if (src && !src.startsWith('blob:')) {
                realSrc = src;
                break;
              }
            }
          } catch(e) {}

          // BFS to find <video> element
          while (queue.length > 0) {
            var root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);

            // Check for video elements
            try {
              var videos = root.querySelectorAll ? root.querySelectorAll('video') : [];
              if (videos.length > 0) {
                foundVideo = videos[0];
                // Try to get non-blob src
                var vSrc = foundVideo.src || foundVideo.currentSrc || '';
                if (vSrc && !vSrc.startsWith('blob:')) {
                  realSrc = vSrc;
                }
                if (!realSrc && foundVideo.querySelector) {
                  var source = foundVideo.querySelector('source');
                  if (source && source.src && !source.src.startsWith('blob:')) {
                    realSrc = source.src;
                  }
                }
              }
            } catch(e) {}

            // Also check custom elements in this root for src attribute
            try {
              var customs = root.querySelectorAll ? root.querySelectorAll('hls-video, video-js, media-player') : [];
              for (var k = 0; k < customs.length; k++) {
                var csrc = customs[k].getAttribute('src') || '';
                if (csrc && !csrc.startsWith('blob:')) {
                  realSrc = csrc;
                }
              }
            } catch(e) {}

            // Queue all shadow roots
            try {
              var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
              for (var i = 0; i < all.length; i++) {
                if (all[i].shadowRoot && !visited.has(all[i].shadowRoot)) {
                  shadowRootsFound++;
                  queue.push(all[i].shadowRoot);
                }
              }
            } catch(e) {}

            // Queue iframes
            try {
              var iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
              for (var j = 0; j < iframes.length; j++) {
                try {
                  var iframeDoc = iframes[j].contentDocument || (iframes[j].contentWindow && iframes[j].contentWindow.document);
                  if (iframeDoc && !visited.has(iframeDoc)) {
                    queue.push(iframeDoc);
                  }
                } catch(e) {}
              }
            } catch(e) {}
          }

          if (foundVideo) {
            // Use real src if found, otherwise use whatever we got (even blob)
            var finalSrc = realSrc || foundVideo.src || foundVideo.currentSrc || '';
            return { found: true, duration: foundVideo.duration || 0, src: finalSrc, isBlob: finalSrc.startsWith('blob:') };
          }

          return { found: false, debug: { shadowRootsFound: shadowRootsFound } };
        })();
      `;

      // Thumbnail capture script
      const captureThumbnail = `
        (function() {
          return new Promise(function(resolve) {
            var v = document.querySelector('video');
            if (!v) return resolve(null);

            var tryCapture = function() {
              if (v.readyState < 2 || v.videoWidth === 0) return false;
              try {
                var canvas = document.createElement('canvas');
                canvas.width = Math.min(v.videoWidth, 320);
                canvas.height = Math.round(canvas.width * v.videoHeight / v.videoWidth);
                var ctx = canvas.getContext('2d');
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/jpeg', 0.7);
              } catch(e) { return null; }
            };

            var result = tryCapture();
            if (result) return resolve(result);

            // Wait for video to be ready
            var attempts = 0;
            var interval = setInterval(function() {
              attempts++;
              var result = tryCapture();
              if (result || attempts > 20) {
                clearInterval(interval);
                resolve(result);
              }
            }, 500);
          });
        })();
      `;

      // Poll for video
      let localPollCount = 0;
      let foundVideo = false;
      const pollVideo = () => {
        localPollCount++;
        setPollCount(localPollCount);

        webview.executeJavaScript(checkVideo).then((result) => {
          if (result && result.found) {
            foundVideo = true;
            videoFoundRef.current = true;
            setVideoFound(true);
            setNeedsLogin(false);
            onVideoDetected?.({ duration: result.duration, src: result.src });

            // Capture thumbnail if not already done
            if (!thumbnailCapturedRef.current && onThumbnailCaptured) {
              thumbnailCapturedRef.current = true;
              webview.executeJavaScript(captureThumbnail).then((thumbnail) => {
                if (thumbnail) onThumbnailCaptured(thumbnail);
              }).catch(() => {});
            }

            // Store detected video URL for download (if not blob:)
            if (result.src && !result.src.startsWith('blob:')) {
              setDetectedVideoUrl(result.src);
            }

            // If we got a direct video file (mp4/webm), switch to native player
            // Note: m3u8/HLS streams need special handling, keep in webview mode
            const canUseNative = result.src &&
              !result.src.startsWith('blob:') &&
              !result.src.includes('.m3u8') &&  // HLS needs HLS.js, keep in webview
              (result.src.includes('.mp4') || result.src.includes('.webm'));

            if (canUseNative) {
              setVideoSrc(result.src);
            } else if (!focusAppliedRef.current) {
              // Apply focus mode to maximize video and hide distractions
              focusAppliedRef.current = true;
              webview.executeJavaScript('window.__revidEnterFocus && window.__revidEnterFocus()').catch(() => {});
            }
          }
        }).catch(() => {});
      };

      // Aggressive polling: 500ms for first 10 seconds, then 2s
      // This handles dynamically loaded video players
      pollVideo();
      let fastPollCount = 0;
      const fastPoll = setInterval(() => {
        fastPollCount++;
        pollVideo();
        // After 20 fast polls (10 seconds), switch to slow polling
        if (fastPollCount >= 20 || foundVideo) {
          clearInterval(fastPoll);
          if (!foundVideo) {
            // Continue with slower polling
            webview._revidPollInterval = setInterval(pollVideo, 2000);
          }
        }
      }, 500);

      // Store interval for cleanup
      webview._revidPollInterval = fastPoll;
    };

    const handleLoadStart = () => {
      // Don't reset loading state if we've already shown the page once
      // (prevents loop from login redirects)
      if (!initialLoadDoneRef.current) {
        setIsLoading(true);
      }
      setVideoFound(false);
      setVideoSrc(null);
      setDetectedVideoUrl(null);
      setPollCount(0);
      seekedRef.current = false;
      focusAppliedRef.current = false;
      thumbnailCapturedRef.current = false;
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



  // Poll video state for controls (always runs when video found in webview mode)
  useEffect(() => {
    if (!videoFound || videoSrc || !webviewRef.current) {
      if (focusStateIntervalRef.current) {
        clearInterval(focusStateIntervalRef.current);
        focusStateIntervalRef.current = null;
      }
      return;
    }

    const pollState = () => {
      const webview = webviewRef.current;
      if (!webview) return;

      webview.executeJavaScript(`
        (function() {
          var v = document.querySelector('video');
          if (v) return { currentTime: v.currentTime, duration: v.duration || 0, paused: v.paused };
          return null;
        })();
      `).then(result => {
        if (result) setFocusVideoState(result);
      }).catch(() => {});
    };

    pollState();
    focusStateIntervalRef.current = setInterval(pollState, 500);

    return () => {
      if (focusStateIntervalRef.current) {
        clearInterval(focusStateIntervalRef.current);
      }
    };
  }, [videoFound, videoSrc]);

  // Focus mode video controls
  const focusTogglePlay = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    webview.executeJavaScript(`
      (function() {
        var v = document.querySelector('video');
        if (v) { v.paused ? v.play() : v.pause(); }
      })();
    `).catch(() => {});
  }, []);

  const focusSeek = useCallback((time) => {
    const webview = webviewRef.current;
    if (!webview) return;
    webview.executeJavaScript(`
      (function() {
        var v = document.querySelector('video');
        if (v) v.currentTime = ${time};
      })();
    `).catch(() => {});
  }, []);

  const focusSkip = useCallback((delta) => {
    const webview = webviewRef.current;
    if (!webview) return;
    webview.executeJavaScript(`
      (function() {
        var v = document.querySelector('video');
        if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + ${delta}));
      })();
    `).catch(() => {});
  }, []);

  const partition = `persist:theater-${platform}`;

  // Handle video download
  const handleDownload = useCallback(async () => {
    const srcToDownload = videoSrc || detectedVideoUrl;
    if (!srcToDownload) return;

    const api = window.electronAPI;
    if (!api?.downloadVideo) return;

    setDownloadProgress({ progress: 0, status: 'downloading' });

    // Listen for progress
    const unsubscribe = api.onDownloadProgress?.(({ progress }) => {
      setDownloadProgress({ progress, status: 'downloading' });
    });

    try {
      const filename = srcToDownload.split('/').pop()?.split('?')[0] || 'video.mp4';
      const result = await api.downloadVideo(srcToDownload, filename);

      if (result.success) {
        setDownloadProgress({ progress: 100, status: 'complete' });
        setTimeout(() => setDownloadProgress(null), 2000);
      } else if (!result.canceled) {
        setDownloadProgress({ progress: 0, status: 'failed' });
        setTimeout(() => setDownloadProgress(null), 2000);
      } else {
        setDownloadProgress(null);
      }
    } catch {
      setDownloadProgress({ progress: 0, status: 'failed' });
      setTimeout(() => setDownloadProgress(null), 2000);
    }

    unsubscribe?.();
  }, [videoSrc, detectedVideoUrl]);

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

      // Capture thumbnail for native video
      if (!thumbnailCapturedRef.current && onThumbnailCaptured) {
        const tryCapture = () => {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = Math.min(video.videoWidth, 320);
              canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
              const ctx = canvas.getContext('2d');
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
              thumbnailCapturedRef.current = true;
              onThumbnailCaptured(thumbnail);
            } catch (e) { /* CORS or other error */ }
          }
        };
        // Try immediately or wait for more data
        if (video.readyState >= 2) tryCapture();
        else video.addEventListener('canplay', tryCapture, { once: true });
      }

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
  }, [videoSrc, startAt, onVideoState, onVideoDetected, onThumbnailCaptured]);

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

          {/* Download button */}
          <button
            onClick={handleDownload}
            disabled={!!downloadProgress}
            style={{
              position: 'absolute', top: 12, right: 12, zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: downloadProgress?.status === 'complete' ? 'rgba(34,197,94,0.9)'
                : downloadProgress?.status === 'failed' ? 'rgba(239,68,68,0.9)'
                : 'rgba(0,0,0,0.7)',
              color: '#fff', fontSize: 12, fontWeight: 500,
              cursor: downloadProgress ? 'default' : 'pointer',
              transition: 'background 0.2s',
              backdropFilter: 'blur(4px)',
            }}
          >
            {downloadProgress ? (
              downloadProgress.status === 'downloading' ? (
                <>{t('downloading')} {downloadProgress.progress}%</>
              ) : downloadProgress.status === 'complete' ? (
                <>{t('downloadComplete')}</>
              ) : (
                <>{t('downloadFailed')}</>
              )
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t('download')}
              </>
            )}
          </button>

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
        {playlist.length > 0 && (
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
    <div
      className={`relative flex ${className}`}
      style={{ background: '#000' }}
    >
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Webview */}
        <webview
          ref={webviewRef}
          src={url}
          partition={partition}
          style={{ flex: 1, width: '100%', minHeight: 0 }}
          allowpopups="true"
        />


        {/* Loading overlay - only show briefly, then fade to hint */}
        {isLoading && !needsLogin && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-white/30 border-t-primary rounded-full animate-spin" />
              <span className="text-white/60 text-sm">{t('detectingVideo')}</span>
            </div>
          </div>
        )}

        {/* Login hint - non-blocking banner at top */}
        {needsLogin && !videoFound && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            padding: '8px 16px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), rgba(0,0,0,0))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontSize: 13, color: '#fff' }}>
              {t('loginRequired')}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              {t('loginHint')}
            </span>
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

        {/* Fixed bottom playback toolbar */}
        {videoFound && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 16px',
              background: 'rgba(0,0,0,0.9)',
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {/* Play/Pause */}
            <button
              onClick={focusTogglePlay}
              style={{
                padding: 6, borderRadius: 6, cursor: 'pointer',
                color: '#fff', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {focusVideoState.paused ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              )}
            </button>

            {/* Time */}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', minWidth: 36 }}>
              {Math.floor(focusVideoState.currentTime / 60)}:{String(Math.floor(focusVideoState.currentTime % 60)).padStart(2, '0')}
            </span>

            {/* Progress bar */}
            <input
              type="range"
              min="0"
              max={focusVideoState.duration || 100}
              value={focusVideoState.currentTime}
              onChange={(e) => focusSeek(parseFloat(e.target.value))}
              style={{
                flex: 1, height: 4, cursor: 'pointer',
                accentColor: theme.accent,
              }}
            />

            {/* Duration */}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', minWidth: 36 }}>
              {Math.floor((focusVideoState.duration || 0) / 60)}:{String(Math.floor((focusVideoState.duration || 0) % 60)).padStart(2, '0')}
            </span>

            {/* Download button - show when downloadable URL available */}
            {detectedVideoUrl && (
              <>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)' }} />
                <button
                  onClick={handleDownload}
                  disabled={!!downloadProgress}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px', borderRadius: 4,
                    background: downloadProgress?.status === 'complete' ? 'rgba(34,197,94,0.9)'
                      : downloadProgress?.status === 'failed' ? 'rgba(239,68,68,0.9)'
                      : 'rgba(255,255,255,0.1)',
                    color: '#fff', fontSize: 11,
                    cursor: downloadProgress ? 'default' : 'pointer',
                  }}
                >
                  {downloadProgress ? (
                    downloadProgress.status === 'downloading' ? `${downloadProgress.progress}%`
                    : downloadProgress.status === 'complete' ? '✓'
                    : '✗'
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      {t('download')}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
