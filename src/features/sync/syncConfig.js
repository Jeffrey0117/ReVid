// Sync server URL rules — mirrors parseBaseUrl() in electron/sync-client.cjs.
// Public servers must use HTTPS; plain HTTP is allowed only for this machine.

export const normalizeBaseUrl = (raw) => {
  try {
    const url = new URL(String(raw || '').trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
};

// Delays (ms) — docs/SYNC-API.md §6.1
export const SYNC_TIMING = {
  contentDebounce: 3000,
  progressThrottle: 30000,
  pollInterval: 5 * 60 * 1000,
  focusMinGap: 30000,
  retryBase: 5000,
  retryMax: 5 * 60 * 1000,
  pageLimit: 500,
  pushChunk: 500,
};
