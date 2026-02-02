/**
 * JavaScript injection script for webview <video> detection.
 * This script is injected into course webviews to:
 * 1. Find the largest <video> element on the page
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

  // Find the largest video element on the page
  function findLargestVideo() {
    const videos = document.querySelectorAll('video');
    let best = null;
    let bestArea = 0;

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = video;
      }
    }

    // Minimum size threshold (100x75)
    if (best && bestArea > 7500) {
      return best;
    }
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

    // Make video container full width
    if (videoContainer) {
      videoContainer.style.cssText += ';max-width:100%!important;width:100%!important;margin:0!important;';
    }
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
      activeVideo = video;

      // Start reporting
      if (reportInterval) clearInterval(reportInterval);
      reportInterval = setInterval(reportState, 1000);

      // Notify host that video was found
      window.postMessage({
        type: 'revid-video-detected',
        duration: video.duration || 0,
        src: video.src || video.currentSrc || ''
      }, '*');
    }
  }

  // Initial detection + periodic re-check (for SPAs)
  detectVideo();
  const detectInterval = setInterval(() => {
    if (!activeVideo || !document.contains(activeVideo)) {
      activeVideo = null;
      detectVideo();
    }
  }, 2000);

  // MutationObserver for dynamic content
  const observer = new MutationObserver(() => {
    if (!activeVideo || !document.contains(activeVideo)) {
      activeVideo = null;
      detectVideo();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (reportInterval) clearInterval(reportInterval);
    clearInterval(detectInterval);
    observer.disconnect();
    exitFocusMode();
  });
})();
`;
