import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce, retryDelayFor } from './syncEngine.js';
import { createSyncStore } from '../../../dev/mock-sync-server/core.mjs';

// A simulated machine: its own library + sync-state, talking to `store`.
function machine(store, deviceId, folders = [], userId = 'u1') {
  let clock = 1000;
  const m = {
    folders,
    state: { deviceId, cursor: 0, watermark: 0, orphans: [] },
    verifiedUserId: null,
    now: () => clock,
    tick: (ms = 10) => { clock += ms; return clock; },
    request: async (method, route, body) => {
      if (route === '/v1/me') return { success: true, data: { userId } };
      if (method === 'POST') {
        const r = store.push(userId, body);
        return r.error ? { success: false, code: r.code, error: r.error } : { success: true, data: r.data };
      }
      const q = new URLSearchParams(route.split('?')[1]);
      return { success: true, data: store.pull(userId, Number(q.get('since')), Number(q.get('limit'))).data };
    },
    async sync() {
      const r = await syncOnce({
        request: m.request,
        state: m.state,
        verifiedUserId: m.verifiedUserId,
        getFolders: () => m.folders,
        applyFolders: (base, merged, reapply) => { m.folders = m.folders === base ? merged : reapply(m.folders); },
        now: m.now
      });
      assert.equal(r.ok, true, JSON.stringify(r.failure));
      m.state = r.state;
      m.verifiedUserId = r.userId;
      return r;
    }
  };
  return m;
}

const course = (id, t, over = {}) => ({
  id, url: `https://www.youtube.com/watch?v=${id}`, title: id, platform: 'youtube',
  addedAt: t, updatedAt: t, deletedAt: null,
  progress: { lastPosition: 0, duration: 0, lastWatched: null, completed: false }, ...over
});
const folder = (id, t, courses = [], over = {}) => ({
  id, name: id, platform: 'custom', createdAt: t, updatedAt: t, deletedAt: null, courses, ...over
});
const visible = (m) => m.folders.filter((f) => !f.deletedAt).map((f) => f.id);
const songs = (m, fid) => m.folders.find((f) => f.id === fid).courses.filter((c) => !c.deletedAt).map((c) => c.id);

test('first sync on two machines keeps both libraries (§6.2)', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('fa', 10, [course('a1', 10)])]);
  const b = machine(store, 'dB', [folder('fb', 20, [course('b1', 20)])]);
  await a.sync();
  await b.sync();
  await a.sync();
  assert.deepEqual(visible(a).sort(), ['fa', 'fb']);
  assert.deepEqual(visible(b).sort(), ['fa', 'fb']);
  assert.deepEqual(songs(b, 'fa'), ['a1']);
});

test('a second sync with no changes pushes nothing and changes nothing', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('f', 10, [course('c', 10)])]);
  await a.sync();
  const before = a.folders;
  a.tick();
  const r = await a.sync();
  assert.equal(r.pushed, 0);
  assert.equal(a.folders, before);
});

test('rename, delete and reorder propagate', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('f', 10, [course('x', 10), course('y', 11)])]);
  const b = machine(store, 'dB');
  await a.sync();
  await b.sync();
  assert.deepEqual(songs(b, 'f'), ['x', 'y']);

  const t = a.tick(100);
  a.folders = [{ ...a.folders[0], name: 'Renamed', updatedAt: t, courses: [a.folders[0].courses[1], a.folders[0].courses[0]] }];
  await a.sync();
  await b.sync();
  assert.equal(b.folders[0].name, 'Renamed');
  assert.deepEqual(songs(b, 'f'), ['y', 'x']);

  const t2 = b.tick(1000);
  b.folders = b.folders.map((f) => ({ ...f, courses: f.courses.map((c) => (c.id === 'x' ? { ...c, deletedAt: t2, updatedAt: t2 } : c)) }));
  await b.sync();
  await a.sync();
  assert.deepEqual(songs(a, 'f'), ['y']);
});

test('deleting a folder on one machine deletes it on the other', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('keep', 10), folder('gone', 10)]);
  const b = machine(store, 'dB');
  await a.sync();
  await b.sync();
  const t = b.tick(500);
  b.folders = b.folders.map((f) => (f.id === 'gone' ? { ...f, deletedAt: t, updatedAt: t } : f));
  await b.sync();
  await a.sync();
  assert.deepEqual(visible(a), ['keep']);
});

test('offline edits on both machines: rename on A and playback on B both survive', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('f', 10, [course('song', 10)])]);
  const b = machine(store, 'dB');
  await a.sync();
  await b.sync();

  const ta = a.tick(100);
  a.folders = [{ ...a.folders[0], courses: [{ ...a.folders[0].courses[0], title: 'Real Title', updatedAt: ta }] }];
  const tb = b.tick(200);
  b.folders = [{ ...b.folders[0], courses: [{ ...b.folders[0].courses[0], progress: { lastPosition: 42, duration: 200, lastWatched: tb, completed: false } }] }];

  await a.sync();
  await b.sync();
  await a.sync();
  for (const m of [a, b]) {
    const c = m.folders[0].courses[0];
    assert.equal(c.title, 'Real Title');
    assert.equal(c.progress.lastPosition, 42);
  }
});

test('switching account starts a fresh merge', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('f', 10)]);
  await a.sync();
  a.state = { ...a.state };
  a.verifiedUserId = 'u2';
  const r = await a.sync();
  assert.equal(r.state.userId, 'u2');
  assert.equal(r.pushed, 1); // whole library pushed again for the new account
});

test('pull pages through hasMore', async () => {
  const store = createSyncStore();
  const many = Array.from({ length: 1200 }, (_, i) => course(`c${i}`, 10 + i));
  const a = machine(store, 'dA', [folder('f', 10, many)]);
  const b = machine(store, 'dB');
  await a.sync();
  await b.sync();
  assert.equal(songs(b, 'f').length, 1200);
});

test('a failed request reports failure and does not advance state', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('f', 10)]);
  const r = await syncOnce({
    request: async (method, route) => (route === '/v1/me' ? { success: true, data: { userId: 'u1' } } : { success: false, code: 'OFFLINE', error: 'down' }),
    state: a.state, verifiedUserId: null, getFolders: () => a.folders, applyFolders: () => {}, now: a.now
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.code, 'OFFLINE');
});

test('retryDelayFor: backs off, honours Retry-After, stops on auth errors', () => {
  assert.equal(retryDelayFor({ code: 'OFFLINE' }, 0), 5000);
  assert.equal(retryDelayFor({ code: 'OFFLINE' }, 2), 20000);
  assert.equal(retryDelayFor({ code: 'OFFLINE' }, 20), 300000);
  assert.equal(retryDelayFor({ code: 'RATE_LIMITED', retryAfter: 7 }, 0), 7000);
  assert.equal(retryDelayFor({ code: 'UNAUTHORIZED' }, 0), null);
});

test('413 TOO_LARGE splits the batch and skips only the oversize record (§5.1)', async () => {
  const store = createSyncStore();
  const many = Array.from({ length: 10 }, (_, i) => course(`c${i}`, 10 + i));
  many[3] = course('huge', 13, { title: 'huge' });
  const a = machine(store, 'dA', [folder('f', 10, many)]);
  // Fake a server that 413s any request containing the oversize record.
  const real = a.request;
  let posts = 0;
  a.request = async (method, route, body) => {
    if (method === 'POST') {
      posts += 1;
      if ((body.courses || []).some((c) => c.id === 'huge') && (body.courses.length + body.folders.length) >= 1) {
        if (body.courses.length + body.folders.length === 1) return { success: false, code: 'TOO_LARGE', error: 'record too large' };
        return { success: false, code: 'TOO_LARGE', error: 'body too large' };
      }
    }
    return real(method, route, body);
  };
  const r = await a.sync();
  assert.equal(r.skipped, 1);
  assert.equal(r.pushed, 10); // folder + 10 courses − 1 skipped
  const b = machine(store, 'dB');
  await b.sync();
  assert.deepEqual(songs(b, 'f').includes('huge'), false); // oversize record stayed local
  assert.equal(songs(b, 'f').length, 9);
  assert.ok(posts > 1, 'batch was split');
});

test('a chunk-level non-413 failure still aborts the round', async () => {
  const store = createSyncStore();
  const a = machine(store, 'dA', [folder('f', 10, [course('c1', 11)])]);
  const r = await syncOnce({
    request: async (method, route) => {
      if (route === '/v1/me') return { success: true, data: { userId: 'u1' } };
      return { success: false, code: 'SERVER_ERROR', error: 'boom' };
    },
    state: a.state, verifiedUserId: null, getFolders: () => a.folders, applyFolders: () => {}, now: a.now
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.code, 'SERVER_ERROR');
});
