const metadataCache = new Map();
const MAX_CACHE = 300;

function addToCache(key, value) {
  if (metadataCache.size >= MAX_CACHE) {
    const firstKey = metadataCache.keys().next().value;
    metadataCache.delete(firstKey);
  }
  metadataCache.set(key, value);
}

/**
 * Get video metadata (duration, width, height) via a temp <video> element.
 * @param {string} videoUrl - local-video:// URL
 * @returns {Promise<{duration: number, width: number, height: number} | null>}
 */
export function getVideoMetadata(videoUrl) {
  if (metadataCache.has(videoUrl)) {
    return Promise.resolve(metadataCache.get(videoUrl));
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    let resolved = false;

    const onLoaded = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      const meta = {
        duration: video.duration || 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0
      };
      addToCache(videoUrl, meta);
      cleanup();
      resolve(meta);
    };

    const onError = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      resolve(null);
    };

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, 5000);

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = videoUrl;
  });
}

export function getCachedMetadata(videoUrl) {
  return metadataCache.get(videoUrl) || null;
}

/**
 * Format seconds to mm:ss or hh:mm:ss
 */
export function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format bytes to human readable
 */
export function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
