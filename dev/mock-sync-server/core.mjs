// In-memory reference implementation of the sync server logic
// (docs/SYNC-API.md §4–5). Used by tests and by the dev mock HTTP server;
// the real `revid-sync` backend should behave the same way.
import { mergeFolder, mergeCourse } from '../../src/utils/syncMerge.js';

const MAX_ID = 64;
const MAX_TEXT = 500;
const MAX_RECORD_BYTES = 512 * 1024;

const isTime = (v) => v === null || v === undefined || (Number.isInteger(v) && v >= 0);
const isText = (v) => v === undefined || v === null || (typeof v === 'string' && v.length <= MAX_TEXT);
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

export function validateRecord(kind, rec) {
  if (!rec || typeof rec !== 'object') return 'record must be an object';
  if (typeof rec.id !== 'string' || !rec.id || rec.id.length > MAX_ID) return 'invalid id';
  if (!Number.isInteger(rec.updatedAt) || rec.updatedAt < 0) return 'invalid updatedAt';
  if (!isTime(rec.deletedAt)) return 'invalid deletedAt';
  if (JSON.stringify(rec).length > MAX_RECORD_BYTES) return 'TOO_LARGE';
  if (kind === 'folders') {
    if (!isText(rec.name)) return 'invalid name';
    if (rec.courseOrder !== undefined && !(Array.isArray(rec.courseOrder) && rec.courseOrder.every((id) => typeof id === 'string'))) return 'invalid courseOrder';
  } else {
    if (typeof rec.folderId !== 'string' || !rec.folderId) return 'invalid folderId';
    if (!isHttpUrl(rec.url)) return 'invalid url';
    if (!isText(rec.title)) return 'invalid title';
  }
  return null;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createSyncStore() {
  // userId -> { seq, records: Map(`${kind}:${id}` -> { kind, data, seq }) }
  const users = new Map();
  const userOf = (userId) => {
    if (!users.has(userId)) users.set(userId, { seq: 0, records: new Map() });
    return users.get(userId);
  };

  // POST /v1/sync — merge each record; return server copies that differ.
  function push(userId, body) {
    const user = userOf(userId);
    const conflicts = { folders: [], courses: [] };
    let accepted = 0;
    for (const kind of ['folders', 'courses']) {
      const list = body?.[kind];
      if (list !== undefined && !Array.isArray(list)) return { error: `${kind} must be an array`, code: 'BAD_REQUEST' };
      for (const rec of list || []) {
        const problem = validateRecord(kind, rec);
        if (problem === 'TOO_LARGE') return { error: 'record too large', code: 'TOO_LARGE' };
        if (problem) return { error: `${kind}/${rec?.id}: ${problem}`, code: 'BAD_REQUEST' };
      }
    }
    for (const kind of ['folders', 'courses']) {
      const merge = kind === 'folders' ? mergeFolder : mergeCourse;
      for (const rec of body?.[kind] || []) {
        const key = `${kind}:${rec.id}`;
        const existing = user.records.get(key);
        const merged = merge(existing?.data, rec);
        if (!existing || !same(merged, existing.data)) {
          user.seq += 1;
          user.records.set(key, { kind, data: merged, seq: user.seq });
          accepted += 1;
        }
        if (!same(merged, rec)) conflicts[kind].push(merged);
      }
    }
    return { data: { accepted, conflicts, cursor: user.seq } };
  }

  // GET /v1/sync?since=&limit=
  function pull(userId, since = 0, limit = 500) {
    const user = userOf(userId);
    const cap = Math.min(Math.max(1, limit), 1000);
    const changed = [...user.records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const page = changed.slice(0, cap);
    return {
      data: {
        folders: page.filter((r) => r.kind === 'folders').map((r) => r.data),
        courses: page.filter((r) => r.kind === 'courses').map((r) => r.data),
        cursor: page.length ? page[page.length - 1].seq : Math.max(since, 0),
        hasMore: changed.length > cap
      }
    };
  }

  return { push, pull };
}
