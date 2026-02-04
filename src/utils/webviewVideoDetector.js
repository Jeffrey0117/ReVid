/**
 * JavaScript injection script for webview <video> detection.
 * This script is injected into course webviews to:
 * 1. Find the largest <video> element on the page (including iframes)
 * 2. Hide non-video UI (nav bars, sidebars, etc.)
 * 3. Expose __setPlaybackRate(rate) for host speed control
 * 4. Report playback state every second via postMessage
 */

export const getVideoDetectorScript = () => `
(function() {
  'use strict';

  // Prevent double injection
  if (window.__revidVideoDetector) return;
  window.__revidVideoDetector = true;

  let activeVideo = null;
  let reportInterval = null;
  let focusModeActive = false;
  let videoIframe = null; // Track if video is inside an iframe

  // Collect all videos from document, iframes, and shadow DOMs
  function collectAllVideos(doc, results, visitedRoots) {
    if (!doc) return;
    if (!visitedRoots) visitedRoots = new Set();
    if (visitedRoots.has(doc)) return;
    visitedRoots.add(doc);

    try {
      // Get videos from this document
      const videos = doc.querySelectorAll('video');
      for (const v of videos) {
        results.push({ video: v, doc: doc });
      }

      // Check shadow DOMs
      const allElements = doc.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          collectAllVideos(el.shadowRoot, results, visitedRoots);
        }
      }

      // Check iframes (same-origin only)
      const iframes = doc.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            collectAllVideos(iframeDoc, results, visitedRoots);
          }
        } catch (e) {
          // Cross-origin iframe, can't access
        }
      }
    } catch (e) {
      // Document access error
    }
  }

  // Find the largest video element on the page (including iframes)
  function findLargestVideo() {
    const results = [];
    collectAllVideos(document, results);

    let best = null;
    let bestArea = 0;
    let bestDoc = null;

    for (const { video, doc } of results) {
      try {
        const rect = video.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > bestArea) {
          bestArea = area;
          best = video;
          bestDoc = doc;
        }
      } catch (e) {
        // Skip if can't get bounding rect
      }
    }

    // Minimum size threshold (100x75)
    if (best && bestArea > 7500) {
      // Track if video is in an iframe
      videoIframe = (bestDoc !== document) ? bestDoc : null;
      return best;
    }

    videoIframe = null;
    return null;
  }

  // Hide distracting UI elements (navigation, sidebars, etc.)
  function enterFocusMode(video) {
    if (focusModeActive) return;
    focusModeActive = true;

    // Common selectors for navigation and sidebar elements
    const distractors = [
      'nav', 'header', 'footer',
      '[role="navigation"]', '[role="banner"]',
      '.sidebar', '.side-bar', '.nav-bar', '.navbar',
      '.header', '.footer',
      '[class*="sidebar"]', '[class*="navigation"]',
      '[class*="header"]', '[class*="footer"]',
      '[data-purpose="sidebar"]',
      '[data-purpose="header"]'
    ];

    // Find the video's closest container
    const videoContainer = video.closest('[class*="player"]') ||
                           video.closest('[class*="video"]') ||
                           video.parentElement;

    for (const selector of distractors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // Don't hide if it contains the video
          if (el.contains(video) || el === videoContainer) continue;
          el.dataset.revidHidden = el.style.display;
          el.style.display = 'none';
        }
      } catch (e) {
        // Some selectors may fail in strict mode
      }
    }

    // Mark video for CSS targeting
    video.setAttribute('data-revid-focus', 'true');

    // Inject CSS with highest specificity
    let styleEl = document.getElementById('revid-focus-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'revid-focus-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = 'video[data-revid-focus="true"]{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:999999!important;object-fit:contain!important;background:#000!important;}body.revid-focus-mode{overflow:hidden!important;}';

    document.body.classList.add('revid-focus-mode');
  }

  // Restore hidden elements
  function exitFocusMode() {
    if (!focusModeActive) return;
    focusModeActive = false;

    const hiddenElements = document.querySelectorAll('[data-revid-hidden]');
    for (const el of hiddenElements) {
      el.style.display = el.dataset.revidHidden || '';
      delete el.dataset.revidHidden;
    }

    // Remove focus mode CSS
    const styleEl = document.getElementById('revid-focus-style');
    if (styleEl) styleEl.remove();

    // Remove video attribute
    if (activeVideo) {
      activeVideo.removeAttribute('data-revid-focus');
    }

    // Remove body class
    document.body.classList.remove('revid-focus-mode');
  }

  // Set playback rate on the active video
  window.__setPlaybackRate = function(rate) {
    if (activeVideo) {
      activeVideo.playbackRate = rate;
    }
  };

  // Toggle focus mode
  window.__toggleFocusMode = function(enable) {
    if (enable && activeVideo) {
      enterFocusMode(activeVideo);
    } else {
      exitFocusMode();
    }
  };

  // Report video state to host
  function reportState() {
    if (!activeVideo) return;

    window.postMessage({
      type: 'revid-video-state',
      currentTime: activeVideo.currentTime,
      duration: activeVideo.duration || 0,
      paused: activeVideo.paused,
      playbackRate: activeVideo.playbackRate
    }, '*');
  }

  // Poll for video element (pages may load video dynamically)
  function detectVideo() {
    const video = findLargestVideo();

    if (video && video !== activeVideo) {
      // Remove listener from previous video
      if (activeVideo) {
        activeVideo.removeEventListener('pause', reportState);
      }
      activeVideo = video;

      // Report state immediately on pause
      activeVideo.addEventListener('pause', reportState);

      // Start reporting
      if (reportInterval) clearInterval(reportInterval);
      reportInterval = setInterval(reportState, 1000);

      // Notify host that video was found
      window.postMessage({
        type: 'revid-video-detected',
        duration: video.duration || 0,
        src: video.src || video.currentSrc || ''
      }, '*');

      // Auto-enter focus mode to hide distractions
      enterFocusMode(video);
    }
  }

  // Check if video is still in document (handles iframes too)
  function isVideoStillValid() {
    if (!activeVideo) return false;
    try {
      // Check in main document
      if (document.contains(activeVideo)) return true;
      // Check if video is in an iframe
      if (videoIframe && videoIframe.contains(activeVideo)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  // Initial detection + periodic re-check (for SPAs and late-loading videos)
  detectVideo();
  const detectInterval = setInterval(() => {
    if (!isVideoStillValid()) {
      activeVideo = null;
      videoIframe = null;
      detectVideo();
    } else if (!activeVideo) {
      // Keep trying to find video if not found yet
      detectVideo();
    }
  }, 1500);

  // MutationObserver for dynamic content
  const observer = new MutationObserver(() => {
    if (!isVideoStillValid()) {
      activeVideo = null;
      videoIframe = null;
      detectVideo();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also observe iframes for changes
  function observeIframes() {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && iframeDoc.body) {
          observer.observe(iframeDoc.body, {
            childList: true,
            subtree: true
          });
        }
      } catch (e) {
        // Cross-origin iframe
      }
    }
  }

  // Watch for new iframes
  const iframeObserver = new MutationObserver(() => {
    observeIframes();
    if (!isVideoStillValid()) {
      activeVideo = null;
      videoIframe = null;
      detectVideo();
    }
  });

  iframeObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial iframe observation
  setTimeout(observeIframes, 1000);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (reportInterval) clearInterval(reportInterval);
    clearInterval(detectInterval);
    observer.disconnect();
    iframeObserver.disconnect();
    exitFocusMode();
  });
})();
`;
