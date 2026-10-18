// Record bookkeeping for theater folders/courses, shaped for cloud sync
// (see docs/SYNC-API.md §3–4). Pure functions — no React, no I/O.
//
// - Every content change stamps `updatedAt` (sync merges by it).
// - Deleted folders/courses stay as tombstones (`deletedAt`) so another
//   machine can tell "deleted" apart from "not synced yet".
// - Playback progress deliberately does NOT touch `updatedAt`; it merges on
//   its own `progress.lastWatched`.

// Tombstones older than this are dropped locally (the server purges too).
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const touch = (record, now = Date.now()) => ({ ...record, updatedAt: now });

export const markDeleted = (record, now = Date.now()) => ({ ...record, deletedAt: now, updatedAt: now });

export const isAlive = (record) => !record.deletedAt;

export const visibleFolders = (folders) => folders.filter(isAlive);

const isExpiredTombstone = (record, now) =>
  !!record.deletedAt && now - record.deletedAt > TOMBSTONE_TTL_MS;

const normalizeCourse = (course) => ({
  ...course,
  deletedAt: course.deletedAt ?? null,
  updatedAt: course.updatedAt ?? course.deletedAt ?? course.addedAt ?? 0
});

const normalizeFolder = (folder, now) => ({
  ...folder,
  deletedAt: folder.deletedAt ?? null,
  updatedAt: folder.updatedAt ?? folder.createdAt ?? 0,
  courses: (folder.courses || [])
    .filter((c) => !isExpiredTombstone(c, now))
    .map(normalizeCourse)
});

// Backfill sync fields on data saved by older versions and prune expired
// tombstones. Idempotent: running it on already-normalized data is a no-op.
export const normalizeLoadedFolders = (folders, now = Date.now()) =>
  folders
    .filter((f) => !isExpiredTombstone(f, now))
    .map((f) => normalizeFolder(f, now));

// The order to sync for a folder: live and deleted ids alike, in local order.
export const courseOrderOf = (folder) => (folder.courses || []).map((c) => c.id);
