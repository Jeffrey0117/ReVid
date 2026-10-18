import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOMBSTONE_TTL_MS, touch, markDeleted, isAlive, visibleFolders,
  normalizeLoadedFolders, courseOrderOf
} from './theaterRecords.js';

const NOW = 1_800_000_000_000;

test('touch stamps updatedAt without mutating', () => {
  const folder = { id: 'f1', name: 'a', updatedAt: 1 };
  const result = touch(folder, NOW);
  assert.equal(result.updatedAt, NOW);
  assert.equal(folder.updatedAt, 1);
});

test('markDeleted sets deletedAt and updatedAt together', () => {
  const result = markDeleted({ id: 'f1' }, NOW);
  assert.equal(result.deletedAt, NOW);
  assert.equal(result.updatedAt, NOW);
  assert.equal(isAlive(result), false);
});

test('visibleFolders hides tombstones', () => {
  const folders = [{ id: 'a', deletedAt: null }, { id: 'b', deletedAt: NOW }];
  assert.deepEqual(visibleFolders(folders).map((f) => f.id), ['a']);
});

test('normalizeLoadedFolders backfills updatedAt from createdAt / addedAt', () => {
  const [folder] = normalizeLoadedFolders([{
    id: 'f1', createdAt: 100,
    courses: [{ id: 'c1', addedAt: 200 }, { id: 'c2', addedAt: 300, deletedAt: NOW - 1000 }]
  }], NOW);
  assert.equal(folder.updatedAt, 100);
  assert.equal(folder.deletedAt, null);
  assert.equal(folder.courses[0].updatedAt, 200);
  assert.equal(folder.courses[0].deletedAt, null);
  assert.equal(folder.courses[1].updatedAt, NOW - 1000);
});

test('normalizeLoadedFolders keeps existing updatedAt and is idempotent', () => {
  const once = normalizeLoadedFolders([{ id: 'f1', createdAt: 1, updatedAt: 50, courses: [] }], NOW);
  assert.equal(once[0].updatedAt, 50);
  assert.deepEqual(normalizeLoadedFolders(once, NOW), once);
});

test('normalizeLoadedFolders prunes only expired tombstones', () => {
  const old = NOW - TOMBSTONE_TTL_MS - 1;
  const recent = NOW - 1000;
  const result = normalizeLoadedFolders([
    { id: 'gone', deletedAt: old, courses: [] },
    { id: 'kept', deletedAt: recent, courses: [] },
    { id: 'live', courses: [{ id: 'c-old', deletedAt: old }, { id: 'c-new', deletedAt: recent }] }
  ], NOW);
  assert.deepEqual(result.map((f) => f.id), ['kept', 'live']);
  assert.deepEqual(result[1].courses.map((c) => c.id), ['c-new']);
});

test('normalizeLoadedFolders tolerates a folder without courses', () => {
  const [folder] = normalizeLoadedFolders([{ id: 'f1', createdAt: 1 }], NOW);
  assert.deepEqual(folder.courses, []);
});

test('courseOrderOf lists ids in local order', () => {
  assert.deepEqual(courseOrderOf({ courses: [{ id: 'b' }, { id: 'a' }] }), ['b', 'a']);
});
