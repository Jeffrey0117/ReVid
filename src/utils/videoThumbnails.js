const MAX_CACHE_SIZE = 200;
const THUMBNAIL_TIMEOUT_MS = 10000;
const thumbnailCache = new Map();

function addToCache(key, value) {
  if (thumbnailCache.size >= MAX_CACHE_SIZE) {
    const firstKey = thumbnailCache.keys().next().value;
    thumbnailCache.delete(firstKey);
  }
  thumbnailCache.set(key, value);
}

// A frame one second in is the channel logo, a fade from black, or nothing.
// Halfway through is the episode. 'middle' is the default for that reason;
// a number still means that many seconds in, capped inside the video.
export const MIDDLE = 'middle';

export function seekTargetFor(duration, seekTime) {
    const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
    if (seekTime === MIDDLE) return length ? length / 2 : 1;
    if (!length) return seekTime;
    // Never past the end, and never so early it catches the fade-in.
    return Math.min(seekTime, length * 0.1 || seekTime);
}

export async function generateVideoThumbnail(videoSrc, seekTime = MIDDLE) {
  const cacheKey = `${videoSrc}@${seekTime}`;
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey);
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    let resolved = false;

    const onLoadedMetadata = () => {
      video.currentTime = seekTargetFor(video.duration, seekTime);
    };

    const onSeeked = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      try {
        const canvas = document.createElement('canvas');
        const maxSize = 256;
        const ratio = Math.min(maxSize / video.videoWidth, maxSize / video.videoHeight);
        canvas.width = Math.round(video.videoWidth * ratio);
        canvas.height = Math.round(video.videoHeight * ratio);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        addToCache(cacheKey, dataUrl);
        cleanup();
        resolve(dataUrl);
      } catch (err) {
        cleanup();
        resolve(null);
      }
    };

    const onError = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve(null);
      }
    };

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('seeked', onSeeked);
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
    }, THUMBNAIL_TIMEOUT_MS);

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    video.src = videoSrc;
  });
}

export function clearThumbnailCache() {
  thumbnailCache.clear();
}

export function getCachedThumbnail(videoSrc, seekTime = MIDDLE) {
  return thumbnailCache.get(`${videoSrc}@${seekTime}`) || null;
}
