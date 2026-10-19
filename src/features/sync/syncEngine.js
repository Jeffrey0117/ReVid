// One sync round: identify → push local changes → pull remote changes →
// merge (docs/SYNC-API.md §6). No React / Electron here — the caller injects
// `request` (HTTP), the current library, and how to apply the merge, which
// keeps this testable against an in-memory server.
import { collectDirty, applyRemote } from '../../utils/syncMerge.js';
import { SYNC_TIMING } from './syncConfig.js';

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const freshStateFor = (state, userId) => ({
  ...state, userId, cursor: 0, watermark: 0, orphans: []
});

/**
 * @param {object}   p
 * @param {Function} p.request       (method, route, body?) → Promise<{ success, data | code, error }>
 * @param {object}   p.state         sync-state ({ deviceId, userId, cursor, watermark, orphans })
 * @param {string?}  p.verifiedUserId userId already confirmed this session (skips /v1/me)
 * @param {Function} p.getFolders    () → current full library (tombstones included)
 * @param {Function} p.applyFolders  (base, merged, reapply) → void; see useTheaterSync
 * @param {Function} [p.now]
 * @returns {Promise<{ ok: true, state, userId, pushed, pulled } | { ok: false, failure, userId? }>}
 */
export async function syncOnce({ request, state, verifiedUserId, getFolders, applyFolders, now = Date.now }) {
  let userId = verifiedUserId;
  if (!userId) {
    const me = await request('GET', '/v1/me');
    if (!me.success) return { ok: false, failure: me };
    userId = me.data?.userId;
    if (!userId) return { ok: false, failure: { code: 'SERVER_ERROR', error: 'Server returned no userId' } };
  }

  // Different account (or first sync): start over and merge everything (§6.2–6.3).
  let next = state.userId === userId ? { ...state } : freshStateFor(state, userId);

  // Push. Watermark is taken *before* collecting so edits made during the
  // round are pushed next time (−1 guards same-millisecond edits).
  const pushStartedAt = now() - 1;
  const dirty = collectDirty(getFolders(), next.watermark || 0);
  const incoming = { folders: [], courses: [] };
  const records = [
    ...dirty.folders.map((r) => ['folders', r]),
    ...dirty.courses.map((r) => ['courses', r])
  ];
  // 413 TOO_LARGE → split the batch in half; a single record that is still too
  // large is skipped (it stays local-only until edited) instead of wedging the
  // whole round in a retry loop (§5.1 「拆小批 / 跳過該筆」).
  let skipped = 0;
  const pushPart = async (part) => {
    const body = { deviceId: next.deviceId, folders: [], courses: [] };
    for (const [kind, rec] of part) body[kind].push(rec);
    const res = await request('POST', '/v1/sync', body);
    if (res.success) {
      incoming.folders.push(...(res.data?.conflicts?.folders || []));
      incoming.courses.push(...(res.data?.conflicts?.courses || []));
      return null;
    }
    if (res.code === 'TOO_LARGE') {
      if (part.length === 1) { skipped += 1; return null; }
      const mid = Math.ceil(part.length / 2);
      const failure = await pushPart(part.slice(0, mid));
      return failure || pushPart(part.slice(mid));
    }
    return res;
  };
  for (const part of chunk(records, SYNC_TIMING.pushChunk)) {
    const failure = await pushPart(part);
    if (failure) return { ok: false, failure, userId };
  }

  // Pull everything since our cursor, all pages, then merge once (so a course
  // never arrives before its folder within a round).
  let cursor = next.cursor || 0;
  for (;;) {
    const res = await request('GET', `/v1/sync?since=${cursor}&limit=${SYNC_TIMING.pageLimit}`);
    if (!res.success) return { ok: false, failure: res, userId };
    incoming.folders.push(...(res.data?.folders || []));
    incoming.courses.push(...(res.data?.courses || []));
    if (typeof res.data?.cursor === 'number') cursor = res.data.cursor;
    if (!res.data?.hasMore) break;
  }

  const remote = { ...incoming, orphans: next.orphans || [] };
  const base = getFolders();
  const result = applyRemote(base, remote);
  if (result.changed) {
    applyFolders(base, result.folders, (latest) => applyRemote(latest, remote).folders);
  }

  next = { ...next, cursor, watermark: pushStartedAt, orphans: result.orphans, lastSyncedAt: now() };
  return {
    ok: true,
    state: next,
    userId,
    pushed: records.length - skipped,
    skipped,
    pulled: incoming.folders.length + incoming.courses.length
  };
}

// Retry delay after a failed round; null = don't auto-retry (needs the user).
export const retryDelayFor = (failure, attempt) => {
  if (failure?.code === 'UNAUTHORIZED' || failure?.code === 'BAD_CONFIG' || failure?.code === 'BAD_REQUEST') return null;
  if (failure?.code === 'RATE_LIMITED' && failure.retryAfter) return failure.retryAfter * 1000;
  return Math.min(SYNC_TIMING.retryBase * 2 ** attempt, SYNC_TIMING.retryMax);
};
