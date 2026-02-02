/**
 * YouTube URL parsing utilities.
 *
 * Supports:
 *   youtube.com/watch?v=ID
 *   youtu.be/ID
 *   youtube.com/embed/ID
 *   youtube.com/shorts/ID
 *   youtube.com/live/ID
 *   youtube.com/v/ID
 */

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extract a YouTube video ID from a URL string.
 * Returns the 11-char ID or null if not a valid YouTube URL.
 */
export const extractYouTubeVideoId = (url) => {
  if (!url || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    // youtu.be/ID
    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      return VIDEO_ID_RE.test(id) ? id : null;
    }

    if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;

    // /watch?v=ID
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id && VIDEO_ID_RE.test(id) ? id : null;
    }

    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    const segmentMatch = parsed.pathname.match(
      /^\/(embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/
    );
    if (segmentMatch) {
      return segmentMatch[2];
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Extract a YouTube playlist ID from a URL string.
 * Returns the playlist ID or null.
 */
export const extractYouTubePlaylistId = (url) => {
  if (!url || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') {
      return null;
    }

    const listId = parsed.searchParams.get('list');
    return listId || null;
  } catch {
    return null;
  }
};

/**
 * Check whether a URL is a valid YouTube video URL.
 */
export const isYouTubeUrl = (url) => extractYouTubeVideoId(url) !== null;
