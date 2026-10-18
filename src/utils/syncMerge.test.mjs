import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_INLINE_ASSET, mergeFolder, mergeCourse, mergeProgress,
  folderToWire, courseToWire, collectDirty, applyRemote
} from './syncMerge.js';

const course = (id, over = {}) => ({
  id, url: `https://www.youtube.com/watch?v=${id}`, title: id, platform: 'youtube',
  addedAt: 1, updatedAt: 1, deletedAt: null,
  progress: { lastPosition: 0, duration: 0, lastWatched: null, completed: false },
  ...over
});
const folder = (id, courses = [], over = {}) => ({
  id, name: id, platform: 'custom', createdAt: 1, updatedAt: 1, deletedAt: null, courses, ...over
});

// --- merge rules ---

test('mergeFolder: newer updatedAt wins', () => {
  const a = { id: 'f', name: 'old', updatedAt: 1 };
  const b = { id: 'f', name: 'new', updatedAt: 2 };
  assert.equal(mergeFolder(a, b).name, 'new');
  assert.equal(mergeFolder(b, a).name, 'new');
});

test('mergeFolder: tie is deterministic regardless of argument order', () => {
  const a = { id: 'f', name: 'aaa', updatedAt: 5 };
  const b = { id: 'f', name: 'zzz', updatedAt: 5 };
  assert.deepEqual(mergeFolder(a, b), mergeFolder(b, a));
});

test('mergeFolder: missing side returns the other', () => {
  const a = { id: 'f', updatedAt: 1 };
  assert.equal(mergeFolder(undefined, a), a);
  assert.equal(mergeFolder(a, null), a);
});

test('mergeFolder: field absent on the winner is kept from the loser', () => {
  const local = { id: 'f', cover: 'data:big', updatedAt: 1 };
  const remote = { id: 'f', name: 'renamed', updatedAt: 2 };
  assert.deepEqual(mergeFolder(local, remote), { id: 'f', cover: 'data:big', name: 'renamed', updatedAt: 2 });
});

test('mergeCourse: rename on one side and progress on the other both survive', () => {
  const renamed = course('c', { title: 'Renamed', updatedAt: 10, progress: { lastPosition: 5, lastWatched: 100 } });
  const played = course('c', { title: 'c', updatedAt: 1, progress: { lastPosition: 90, lastWatched: 200 } });
  const merged = mergeCourse(renamed, played);
  assert.equal(merged.title, 'Renamed');
  assert.equal(merged.progress.lastPosition, 90);
  assert.deepEqual(mergeCourse(played, renamed), merged);
});

test('mergeCourse: delete wins when it is newer', () => {
  const live = course('c', { updatedAt: 1 });
  const dead = course('c', { updatedAt: 2, deletedAt: 2 });
  assert.equal(mergeCourse(live, dead).deletedAt, 2);
});

test('mergeProgress: null lastWatched loses', () => {
  const a = { lastPosition: 0, lastWatched: null };
  const b = { lastPosition: 3, lastWatched: 5 };
  assert.equal(mergeProgress(a, b), b);
  assert.equal(mergeProgress(b, a), b);
});

// --- wire conversion ---

test('folderToWire: emits courseOrder, drops courses array', () => {
  const wire = folderToWire(folder('f', [course('b'), course('a')]));
  assert.deepEqual(wire.courseOrder, ['b', 'a']);
  assert.equal(wire.courses, undefined);
});

test('folderToWire / courseToWire: oversized data URIs stay local-only', () => {
  const big = `data:image/png;base64,${'A'.repeat(MAX_INLINE_ASSET)}`;
  assert.equal('cover' in folderToWire(folder('f', [], { cover: big })), false);
  assert.equal('thumbnail' in courseToWire(course('c', { thumbnail: big }), 'f'), false);
  assert.equal(folderToWire(folder('f', [], { cover: 'https://x/y.jpg' })).cover, 'https://x/y.jpg');
});

test('courseToWire: adds folderId, drops unknown fields', () => {
  const wire = courseToWire({ ...course('c'), junk: 1 }, 'f');
  assert.equal(wire.folderId, 'f');
  assert.equal('junk' in wire, false);
});

test('collectDirty: separates content and progress changes', () => {
  const folders = [folder('f', [
    course('content', { updatedAt: 20 }),
    course('played', { progress: { lastWatched: 30 } }),
    course('clean')
  ], { updatedAt: 1 })];
  const dirty = collectDirty(folders, 10);
  assert.deepEqual(dirty.courses.map((c) => c.id), ['content', 'played']);
  assert.equal(dirty.folders.length, 0);
  assert.equal(dirty.contentDirty, true);
  assert.equal(dirty.progressDirty, true);

  const onlyPlayed = collectDirty(folders, 25);
  assert.equal(onlyPlayed.contentDirty, false);
  assert.equal(onlyPlayed.progressDirty, true);
});

test('collectDirty: since=0 pushes everything', () => {
  const dirty = collectDirty([folder('f', [course('a'), course('b')])], 0);
  assert.equal(dirty.folders.length, 1);
  assert.equal(dirty.courses.length, 2);
});

// --- applyRemote ---

test('applyRemote: no remote records returns the same array', () => {
  const local = [folder('f')];
  const r = applyRemote(local, { folders: [], courses: [] });
  assert.equal(r.folders, local);
  assert.equal(r.changed, false);
});

test('applyRemote: re-applying our own state is a no-op (same instances)', () => {
  const local = [folder('f', [course('a'), course('b')])];
  const echo = collectDirty(local, 0);
  const r = applyRemote(local, echo);
  assert.equal(r.changed, false);
  assert.equal(r.folders, local);
});

test('applyRemote: adds a new remote folder with its courses in order', () => {
  const remote = {
    folders: [{ ...folderToWire(folder('new')), courseOrder: ['y', 'x'] }],
    courses: [courseToWire(course('x'), 'new'), courseToWire(course('y'), 'new')]
  };
  const r = applyRemote([folder('mine')], remote);
  assert.deepEqual(r.folders.map((f) => f.id), ['mine', 'new']);
  assert.deepEqual(r.folders[1].courses.map((c) => c.id), ['y', 'x']);
  assert.equal(r.folders[1].courses[0].folderId, undefined);
});

test('applyRemote: newer remote order reorders, local-only songs go last', () => {
  const local = [folder('f', [course('a', { addedAt: 1 }), course('b', { addedAt: 2 }), course('local', { addedAt: 9 })], { updatedAt: 1 })];
  const remote = { folders: [{ ...folderToWire(folder('f')), courseOrder: ['b', 'a'], updatedAt: 5 }] };
  const r = applyRemote(local, remote);
  assert.deepEqual(r.folders[0].courses.map((c) => c.id), ['b', 'a', 'local']);
});

test('applyRemote: older remote order does not reorder', () => {
  const local = [folder('f', [course('a'), course('b')], { updatedAt: 9 })];
  const remote = { folders: [{ ...folderToWire(folder('f')), courseOrder: ['b', 'a'], updatedAt: 5 }] };
  const r = applyRemote(local, remote);
  assert.deepEqual(r.folders[0].courses.map((c) => c.id), ['a', 'b']);
});

test('applyRemote: remote folder tombstone is applied', () => {
  const local = [folder('f', [], { updatedAt: 1 })];
  const remote = { folders: [{ ...folderToWire(local[0]), updatedAt: 3, deletedAt: 3 }] };
  assert.equal(applyRemote(local, remote).folders[0].deletedAt, 3);
});

test('applyRemote: course for an unknown folder becomes an orphan, then lands later', () => {
  const lonely = courseToWire(course('c'), 'later');
  const first = applyRemote([folder('f')], { courses: [lonely] });
  assert.deepEqual(first.orphans.map((c) => c.id), ['c']);
  assert.equal(first.changed, false);

  const second = applyRemote(first.folders, { folders: [folderToWire(folder('later'))], orphans: first.orphans });
  assert.deepEqual(second.folders.find((f) => f.id === 'later').courses.map((c) => c.id), ['c']);
  assert.deepEqual(second.orphans, []);
});

test('applyRemote: newer remote course moves it to another folder', () => {
  const local = [folder('a', [course('c', { updatedAt: 1 })]), folder('b')];
  const moved = { ...courseToWire(course('c'), 'b'), updatedAt: 5 };
  const r = applyRemote(local, { courses: [moved] });
  assert.deepEqual(r.folders[0].courses, []);
  assert.deepEqual(r.folders[1].courses.map((c) => c.id), ['c']);
});

test('applyRemote: does not mutate inputs', () => {
  const local = [folder('f', [course('a')], { updatedAt: 1 })];
  const snapshot = JSON.stringify(local);
  applyRemote(local, { folders: [{ ...folderToWire(folder('f')), name: 'x', updatedAt: 2 }], courses: [{ ...courseToWire(course('a'), 'f'), title: 'y', updatedAt: 2 }] });
  assert.equal(JSON.stringify(local), snapshot);
});
