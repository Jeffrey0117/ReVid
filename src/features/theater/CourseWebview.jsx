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
 *   clickPath      - array of click actions to replay on load
 *   onVideoDetected - callback({ duration, src, pageUrl, clickPath })
 *   onVideoState   - callback({ currentTime, duration, paused, playbackRate })
 *   onThumbnailCaptured - callback(thumbnailDataUrl) when thumbnail is captured
 *   className      - additional CSS classes
 *   playlist       - array of courses in same folder for playlist display
 *   currentCourseId - current course id for playlist highlighting
 *   onPlaylistSelect - callback when user selects from playlist
 *   onPlaybackRateChange - callback when speed is changed from toolbar
 */
export const CourseWebview = ({
  url,
  platform = 'custom',
  playbackRate = 1,
  startAt = 0,
  clickPath = [],
  onVideoDetected,
  onVideoState,
  onThumbnailCaptured,
  onPlaybackRateChange,
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
  const [focusVideoState, setFocusVideoState] = useState({ currentTime: 0, duration: 0, paused: true, volume: 1 });
  const [volumeLevel, setVolumeLevel] = useState(1); // Track volume including boost (0-3)
  const [downloadProgress, setDownloadProgress] = useState(null); // null | { progress, status }
  const [needsLogin, setNeedsLogin] = useState(false); // Show login hint after timeout
  const [pollCount, setPollCount] = useState(0);
  const [replayProgress, setReplayProgress] = useState(null); // { current, total } or null
  // Remember user's preferred mode (localStorage persists across sessions)
  const [browseMode, setBrowseMode] = useState(() => {
    try {
      const saved = localStorage.getItem('revid-theater-browse-mode');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [currentUrl, setCurrentUrl] = useState(url); // Track webview's current URL
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const initialLoadDoneRef = useRef(false); // Prevent reload loop from resetting overlay
  const lastUrlRef = useRef(url); // Track URL changes
  const videoFoundRef = useRef(false); // Track if video found (for timeout check)
  const seekedRef = useRef(false);
  const recordedClicksRef = useRef([]); // Track clicks for this session
  const clickPathReplayedRef = useRef(false); // Prevent replaying multiple times
  const clickPathRef = useRef(clickPath); // Keep clickPath in ref for use in effect
  clickPathRef.current = clickPath; // Always update to latest

  // Reset flags when URL changes (new course selected)
  if (url !== lastUrlRef.current) {
    lastUrlRef.current = url;
    initialLoadDoneRef.current = false;
    videoFoundRef.current = false;
    recordedClicksRef.current = [];
    clickPathReplayedRef.current = false;
  }
  const focusAppliedRef = useRef(false);
  const focusStateIntervalRef = useRef(null);
  const thumbnailCapturedRef = useRef(false);

  // Inject video detector script and CSS when webview is ready
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDomReady = () => {
      // Keep loading overlay until video found - better UX
      // Only mark initial load done, don't hide loading
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        // Show login hint after delay if video not found, but keep loading overlay
        setTimeout(() => {
          if (!videoFoundRef.current) {
            setNeedsLogin(true);
          }
        }, 5000); // Longer timeout before showing login hint
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

            // Restore focus target styles
            var targetEl = window.__revidFocusTarget;
            if (targetEl) {
              targetEl.style.position = '';
              targetEl.style.top = '';
              targetEl.style.left = '';
              targetEl.style.width = '';
              targetEl.style.height = '';
              targetEl.style.maxWidth = '';
              targetEl.style.maxHeight = '';
              targetEl.style.zIndex = '';
              targetEl.style.background = '';
              targetEl.style.margin = '';
              targetEl.style.padding = '';
              window.__revidFocusTarget = null;
            }

            // Restore document styles
            document.documentElement.style.background = '';
            document.documentElement.style.overflow = '';
            document.body.style.background = '';
            document.body.style.overflow = '';
            document.body.style.margin = '';
            document.body.style.padding = '';
          };
        })();
      `;
      webview.executeJavaScript(defineFocusFunctions).catch(() => {});

      // Inject click tracking script
      const clickTrackingScript = `
        (function() {
          if (window.__revidClickTracking) {
            console.log('[ReVid] Click tracking already active, clicks so far:', window.__revidRecordedClicks?.length || 0);
            return;
          }
          window.__revidClickTracking = true;
          window.__revidRecordedClicks = [];
          console.log('[ReVid] Click tracking initialized');

          // Generate a unique selector for an element
          function getSelector(el) {
            if (!el || el === document.body || el === document.documentElement) return null;

            // Try ID first
            if (el.id) return '#' + CSS.escape(el.id);

            // Try data attributes
            if (el.dataset.testid) return '[data-testid="' + el.dataset.testid + '"]';
            if (el.dataset.id) return '[data-id="' + el.dataset.id + '"]';

            // Build selector with tag, classes, and text
            var selector = el.tagName.toLowerCase();
            if (el.className && typeof el.className === 'string') {
              var classes = el.className.trim().split(/\\s+/).filter(function(c) {
                return c && !c.match(/^(hover|active|focus|selected|ng-|_)/);
              }).slice(0, 3);
              if (classes.length > 0) {
                selector += '.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
              }
            }

            // Add text content hint for buttons/links
            var text = (el.textContent || '').trim().substring(0, 50);
            if (text && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button')) {
              return { selector: selector, text: text };
            }

            // Add nth-child for uniqueness
            var parent = el.parentElement;
            if (parent) {
              var siblings = Array.from(parent.children).filter(function(c) {
                return c.tagName === el.tagName;
              });
              if (siblings.length > 1) {
                var index = siblings.indexOf(el) + 1;
                selector += ':nth-of-type(' + index + ')';
              }
            }

            return { selector: selector, parentSelector: getSelector(parent) };
          }

          document.addEventListener('click', function(e) {
            // Skip if video already found
            if (window.__revidVideoFound) return;

            var target = e.target;
            // Skip clicks on video elements
            if (target.tagName === 'VIDEO') return;

            var info = getSelector(target);
            if (info) {
              var clickData = {
                selector: typeof info === 'string' ? info : info.selector,
                text: info.text || null,
                parentSelector: info.parentSelector || null,
                timestamp: Date.now()
              };
              window.__revidRecordedClicks.push(clickData);
              console.log('[ReVid] Click recorded:', clickData.selector, clickData.text || '', '| Total:', window.__revidRecordedClicks.length);
            }
          }, true);
        })();
      `;
      webview.executeJavaScript(clickTrackingScript).catch(() => {});

      // Replay saved click path if exists
      const savedClickPath = clickPathRef.current;
      console.log('[ReVid] Checking for click path to replay:', savedClickPath, 'already replayed:', clickPathReplayedRef.current);
      if (savedClickPath && savedClickPath.length > 0 && !clickPathReplayedRef.current) {
        clickPathReplayedRef.current = true;
        console.log('[ReVid] Will replay', savedClickPath.length, 'clicks after page loads');

        const replayClicks = async () => {
          const wv = webviewRef.current;
          if (!wv) {
            setReplayProgress(null);
            return;
          }

          const total = savedClickPath.length;
          setReplayProgress({ current: 0, total });

          for (let i = 0; i < total; i++) {
            // Stop if video found
            if (videoFoundRef.current) {
              setReplayProgress(null);
              return;
            }

            setReplayProgress({ current: i + 1, total });
            const click = savedClickPath[i];
            const replayScript = `
              (function() {
                function findElement(selector, text, parentSelector) {
                  var candidates = document.querySelectorAll(selector);
                  if (candidates.length === 1) return candidates[0];
                  if (text && candidates.length > 1) {
                    for (var i = 0; i < candidates.length; i++) {
                      if (candidates[i].textContent.trim().includes(text)) return candidates[i];
                    }
                  }
                  if (parentSelector) {
                    var parent = document.querySelector(parentSelector);
                    if (parent) {
                      var child = parent.querySelector(selector);
                      if (child) return child;
                    }
                  }
                  if (text) {
                    var all = document.querySelectorAll('button, a, [role="button"], [onclick]');
                    for (var j = 0; j < all.length; j++) {
                      if (all[j].textContent.trim().includes(text)) return all[j];
                    }
                  }
                  return candidates[0] || null;
                }
                var el = findElement(${JSON.stringify(click.selector)}, ${JSON.stringify(click.text)}, ${JSON.stringify(click.parentSelector)});
                if (el) { el.click(); return true; }
                return false;
              })();
            `;

            try {
              if (!webviewRef.current) break;
              await webviewRef.current.executeJavaScript(replayScript);
              await new Promise(resolve => setTimeout(resolve, 1500));
            } catch (e) {
              console.log('[ReVid] Click replay error:', e);
            }
          }
          setReplayProgress(null);
        };

        // Start replay after page settles
        setTimeout(replayClicks, 2000);
      }

      // Only inject video detector script after page is interactive
      // Delay injection to avoid interfering with page load
      setTimeout(() => {
        const script = getVideoDetectorScript();
        webview.executeJavaScript(script).catch(() => {});
      }, 2000);

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

      // Thumbnail capture script (with BFS for Shadow DOM)
      const captureThumbnail = `
        (function() {
          return new Promise(function(resolve) {
            // BFS to find video in Shadow DOM
            function findVideo() {
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

            var v = findVideo();
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
            console.log('[ReVid] pollVideo found video!', result);
            foundVideo = true;
            videoFoundRef.current = true;
            setVideoFound(true);
            setIsLoading(false); // Hide loading overlay
            setNeedsLogin(false);
            setReplayProgress(null); // Hide auto-nav overlay
            setBrowseMode(false); // Auto-switch to focus mode when video found

            // Get current URL from webview for course URL update
            const currentWebviewUrl = webview.getURL?.() || url;
            console.log('[ReVid] currentWebviewUrl:', currentWebviewUrl);

            // Mark video found and get recorded clicks from webview
            webview.executeJavaScript(`
              (function() {
                window.__revidVideoFound = true;
                var clicks = window.__revidRecordedClicks || [];
                console.log('[ReVid-webview] Returning clicks:', clicks.length);
                return JSON.parse(JSON.stringify(clicks));
              })();
            `).then((clicks) => {
              console.log('[ReVid] Video found! Recorded clicks:', clicks);
              onVideoDetected?.({
                duration: result.duration,
                src: result.src,
                pageUrl: currentWebviewUrl,
                clickPath: clicks && clicks.length > 0 ? clicks : null
              });
            }).catch((err) => {
              console.log('[ReVid] Failed to get clicks:', err);
              onVideoDetected?.({
                duration: result.duration,
                src: result.src,
                pageUrl: currentWebviewUrl,
                clickPath: null
              });
            });

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
      // Don't reset videoFound if we already found the video
      // (prevents internal page navigation from resetting detection)
      if (!videoFoundRef.current) {
        setVideoFound(false);
      }
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

    // Track URL changes for browse mode
    const handleNavigate = (event) => {
      setCurrentUrl(event.url);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleLoadStart);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleLoadStart);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      if (webview._revidPollInterval) {
        clearInterval(webview._revidPollInterval);
      }
    };
  }, [url, onVideoDetected]);

  // Listen for messages from injected script
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    // Capture console messages from webview (for cross-context communication)
    const handleConsoleMessage = (event) => {
      const message = event.message;
      if (message && message.startsWith('__REVID_VIDEO_DETECTED__')) {
        try {
          const jsonStr = message.replace('__REVID_VIDEO_DETECTED__', '').trim();
          const data = JSON.parse(jsonStr);
          videoFoundRef.current = true;
          setVideoFound(true);
          setIsLoading(false); // Hide loading overlay
          setNeedsLogin(false);
          setReplayProgress(null); // Hide auto-nav overlay

          // Get clicks and call onVideoDetected
          const currentWebviewUrl = webview.getURL?.() || url;
          webview.executeJavaScript(`
            (function() {
              window.__revidVideoFound = true;
              return window.__revidRecordedClicks || [];
            })();
          `).then((clicks) => {
            onVideoDetected?.({
              duration: data.duration,
              src: data.src,
              pageUrl: currentWebviewUrl,
              clickPath: clicks && clicks.length > 0 ? clicks : null
            });
          }).catch(() => {
            onVideoDetected?.({
              duration: data.duration,
              src: data.src,
              pageUrl: currentWebviewUrl,
              clickPath: null
            });
          });
        } catch (e) {
          // Parse error, ignore
        }
      }

      // Capture click events
      if (message && message.startsWith('__REVID_CLICK__')) {
        try {
          const jsonStr = message.replace('__REVID_CLICK__', '').trim();
          const clickData = JSON.parse(jsonStr);
          recordedClicksRef.current.push(clickData);
          console.log('[ReVid] Recorded click:', clickData);
        } catch (e) {
          // Parse error, ignore
        }
      }
    };

    webview.addEventListener('console-message', handleConsoleMessage);

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
        setIsLoading(false); // Hide loading overlay
        setReplayProgress(null); // Hide auto-nav overlay

        // Get clicks and call onVideoDetected
        const webview = webviewRef.current;
        const currentWebviewUrl = webview?.getURL?.() || url;
        if (webview) {
          webview.executeJavaScript(`
            (function() {
              window.__revidVideoFound = true;
              return window.__revidRecordedClicks || [];
            })();
          `).then((clicks) => {
            onVideoDetected?.({
              duration: data.duration,
              src: data.src,
              pageUrl: currentWebviewUrl,
              clickPath: clicks && clicks.length > 0 ? clicks : null
            });
          }).catch(() => {
            onVideoDetected?.({
              duration: data.duration,
              src: data.src,
              pageUrl: currentWebviewUrl,
              clickPath: null
            });
          });
        }

        // Auto-seek to last position
        if (startAt > 0 && !seekedRef.current) {
          seekedRef.current = true;
          const webview = webviewRef.current;
          if (webview) {
            setTimeout(() => {
              webview.executeJavaScript(`
                (function() {
                  // BFS to find video in Shadow DOM
                  var queue = [document];
                  var visited = new Set();
                  var v = null;
                  while (queue.length > 0) {
                    var root = queue.shift();
                    if (!root || visited.has(root)) continue;
                    visited.add(root);
                    try {
                      var videos = root.querySelectorAll ? root.querySelectorAll('video') : [];
                      if (videos.length > 0) { v = videos[0]; break; }
                      var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
                      for (var i = 0; i < all.length; i++) {
                        if (all[i].shadowRoot && !visited.has(all[i].shadowRoot)) {
                          queue.push(all[i].shadowRoot);
                        }
                      }
                    } catch(e) {}
                  }
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
      webview.removeEventListener('console-message', handleConsoleMessage);
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

  // Manual toggle with save to localStorage
  const toggleBrowseMode = useCallback((newValue) => {
    setBrowseMode(newValue);
    try {
      localStorage.setItem('revid-theater-browse-mode', String(newValue));
    } catch {
      // Ignore
    }
  }, []);

  // Toggle focus mode when browseMode changes
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !videoFound) return;

    if (browseMode) {
      // Exit focus mode - show normal page
      webview.executeJavaScript('window.__revidExitFocus && window.__revidExitFocus()').catch(() => {});
      focusAppliedRef.current = false;
    } else {
      // Re-enter focus mode
      if (!focusAppliedRef.current) {
        focusAppliedRef.current = true;
        webview.executeJavaScript('window.__revidEnterFocus && window.__revidEnterFocus()').catch(() => {});
      }
    }
  }, [browseMode, videoFound]);

  // Navigation functions
  const goBack = useCallback(() => {
    webviewRef.current?.goBack();
  }, []);

  const goForward = useCallback(() => {
    webviewRef.current?.goForward();
  }, []);

  const refresh = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

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

      // Use BFS to find video in nested Shadow DOMs
      webview.executeJavaScript(`
        (function() {
          var queue = [document];
          var visited = new Set();
          while (queue.length > 0) {
            var root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);
            try {
              var videos = root.querySelectorAll ? root.querySelectorAll('video') : [];
              if (videos.length > 0) {
                var v = videos[0];
                return { currentTime: v.currentTime, duration: v.duration || 0, paused: v.paused, volume: v.volume };
              }
              var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
              for (var i = 0; i < all.length; i++) {
                if (all[i].shadowRoot && !visited.has(all[i].shadowRoot)) {
                  queue.push(all[i].shadowRoot);
                }
              }
            } catch(e) {}
          }
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

  // Helper function to find video in nested Shadow DOMs (BFS)
  const findVideoScript = `
    function findVideo() {
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
  `;

  // Focus mode video controls
  const focusTogglePlay = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    webview.executeJavaScript(`
      (function() {
        ${findVideoScript}
        var v = findVideo();
        if (v) { v.paused ? v.play() : v.pause(); }
      })();
    `).catch(() => {});
  }, []);

  const focusSeek = useCallback((time) => {
    const webview = webviewRef.current;
    if (!webview) return;
    webview.executeJavaScript(`
      (function() {
        ${findVideoScript}
        var v = findVideo();
        if (v) v.currentTime = ${time};
      })();
    `).catch(() => {});
  }, []);

  const focusSkip = useCallback((delta) => {
    const webview = webviewRef.current;
    if (!webview) return;
    webview.executeJavaScript(`
      (function() {
        ${findVideoScript}
        var v = findVideo();
        if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + ${delta}));
      })();
    `).catch(() => {});
  }, []);

  const focusSetVolume = useCallback((vol) => {
    setVolumeLevel(vol); // Track locally for UI
    const webview = webviewRef.current;
    if (!webview) return;

    // Simple approach: use native volume for 0-1, show warning for boost
    // Web Audio API has too many issues with webview context
    webview.executeJavaScript(`
      (function() {
        ${findVideoScript}
        var v = findVideo();
        if (!v) return;
        v.volume = Math.min(${vol}, 1);
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
        {/* Browse mode toolbar */}
        {browseMode && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px',
            background: isDark ? '#1a1a1a' : '#f5f5f5',
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          }}>
            {/* Navigation buttons */}
            <button
              onClick={goBack}
              disabled={!canGoBack}
              style={{
                padding: 6, borderRadius: 6, cursor: canGoBack ? 'pointer' : 'default',
                color: canGoBack ? (isDark ? '#fff' : '#1f2937') : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'),
                background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={t('goBack')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={goForward}
              disabled={!canGoForward}
              style={{
                padding: 6, borderRadius: 6, cursor: canGoForward ? 'pointer' : 'default',
                color: canGoForward ? (isDark ? '#fff' : '#1f2937') : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'),
                background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={t('goForward')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              onClick={refresh}
              style={{
                padding: 6, borderRadius: 6, cursor: 'pointer',
                color: isDark ? '#fff' : '#1f2937',
                background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={t('refresh')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>

            {/* URL display - input for selection/copy */}
            <input
              type="text"
              value={currentUrl}
              readOnly
              onClick={(e) => e.target.select()}
              style={{
                flex: 1, padding: '6px 12px', borderRadius: 6,
                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                fontSize: 12, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
                border: 'none', outline: 'none',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            />

            {/* Exit browse mode - only show when video found */}
            {videoFound && (
              <button
                onClick={() => toggleBrowseMode(false)}
                style={{
                  padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                  background: theme.accent, color: '#fff', fontSize: 12, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                title={t('focusMode')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {t('focusMode')}
              </button>
            )}
          </div>
        )}

        {/* Webview */}
        <webview
          ref={webviewRef}
          src={url}
          partition={partition}
          style={{ flex: 1, width: '100%', minHeight: 0, pointerEvents: 'auto' }}
          allowpopups="true"
          webpreferences="contextIsolation=false, nodeIntegration=false, javascript=yes"
        />


        {/* Loading overlay - show until video found */}
        {isLoading && (
          <div className="absolute inset-0 bg-black flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-4">
              <div className="w-8 h-8 border-2 border-white/30 border-t-primary rounded-full animate-spin" />
              <span className="text-white/60 text-sm">{t('detectingVideo')}</span>
              {needsLogin && (
                <button
                  onClick={() => {
                    setIsLoading(false);
                    toggleBrowseMode(true);
                  }}
                  style={{
                    marginTop: 8,
                    padding: '8px 16px', borderRadius: 6,
                    background: theme.accent, color: '#fff',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {t('enterBrowseMode') || '進入瀏覽模式'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Login hint - non-blocking banner at top */}
        {needsLogin && !videoFound && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            padding: '8px 16px',
            pointerEvents: 'none',
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


        {/* Auto-navigation overlay */}
        {replayProgress && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 30,
            background: '#000',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16
          }}>
            <div style={{ fontSize: 14, color: '#fff', fontWeight: 500 }}>
              {t('autoNavigating') || '自動導航中...'}
            </div>
            <div style={{
              width: 200, height: 4, borderRadius: 2,
              background: 'rgba(255,255,255,0.2)'
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                background: theme.accent,
                width: `${(replayProgress.current / replayProgress.total) * 100}%`,
                transition: 'width 0.3s ease'
              }} />
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              {replayProgress.current} / {replayProgress.total}
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

        {/* Fixed bottom playback toolbar - only in focus mode */}
        {videoFound && !browseMode && (
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

            {/* Volume control */}
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => focusSetVolume(volumeLevel > 0 ? 0 : 1)}
                style={{
                  padding: 4, borderRadius: 4, cursor: 'pointer',
                  color: '#fff', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                title={volumeLevel > 0 ? 'Mute' : 'Unmute'}
              >
                {volumeLevel > 0 ? (
                  volumeLevel > 1 ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  )
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volumeLevel}
                onChange={(e) => focusSetVolume(parseFloat(e.target.value))}
                style={{
                  width: 70, height: 4, cursor: 'pointer',
                  accentColor: theme.accent,
                }}
                title={`${Math.round(volumeLevel * 100)}%`}
              />
            </div>

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

            {/* Browse mode button */}
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)' }} />
            <button
              onClick={() => toggleBrowseMode(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 4,
                background: 'rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 11,
                cursor: 'pointer',
              }}
              title={t('browseMode')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              {t('browseMode')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
