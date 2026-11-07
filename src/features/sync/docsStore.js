// Account-level documents that follow the user across machines: the word
// list, words marked known, and learning preferences. None of these belong
// to a video file, so unlike subtitles they are meaningful on any device.
//
// The server treats a doc as an opaque blob and merges whole-record
// last-write-wins. That is wrong for a collection — adding a word on the
// desktop and another on the laptop would keep only one side — so
// list-shaped docs are merged item by item here, and the union is pushed
// back. The server's LWW then just decides what is stored, and the devices
// converge.

const STORE_KEY = 'revid-docs';

export const DOC_IDS = {
    WORDBOOK: 'wordbook',
    KNOWN_WORDS: 'known-words',
    LEARN_PREFS: 'learn-prefs'
};

function readAll() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY));
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function writeAll(docs) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(docs)); } catch { /* full */ }
}

export function readDoc(id, fallback = null) {
    const doc = readAll()[id];
    return doc && doc.deletedAt == null ? doc.data : fallback;
}

// Every write stamps a time, which is what makes it syncable at all.
export function writeDoc(id, data) {
    const docs = readAll();
    docs[id] = { id, data, updatedAt: Date.now(), deletedAt: null };
    writeAll(docs);
    return data;
}

// Wire format for a push: the whole set, the caller filters by watermark.
export function listDocs() {
    return Object.values(readAll()).filter(d => d && typeof d.id === 'string');
}

export function collectDirtyDocs(since = 0) {
    return listDocs().filter(d => (d.updatedAt || 0) > since);
}

// --- per-document merge strategies ---------------------------------------
// Which one applies is a property of the document, not of the transport.

// A keyed collection: union by key, newest entry per key wins. Removal is a
// tombstone, so deleting on one device is not undone by another device that
// still has the item.
function mergeKeyed(localList, remoteList, keyOf) {
    const byKey = new Map();
    for (const item of [...(localList || []), ...(remoteList || [])]) {
        if (!item) continue;
        const key = keyOf(item);
        if (!key) continue;
        const seen = byKey.get(key);
        if (!seen || (item.updatedAt || item.addedAt || 0) >= (seen.updatedAt || seen.addedAt || 0)) {
            byKey.set(key, item);
        }
    }
    return [...byKey.values()].filter(i => !i.removed);
}

const STRATEGIES = {
    [DOC_IDS.WORDBOOK]: (local, remote) => ({
        words: mergeKeyed(local?.words, remote?.words, (w) => w.word)
    }),
    [DOC_IDS.KNOWN_WORDS]: (local, remote) => ({
        // A plain set: the union is right, and un-knowing a word is rare
        // enough that losing that one edit beats losing the whole list.
        words: [...new Set([...(local?.words || []), ...(remote?.words || [])])]
    })
    // Anything else falls through to whole-document last-write-wins.
};

// Fold pulled docs into the local store. Returns true if anything changed.
export function applyRemoteDocs(remoteDocs) {
    if (!Array.isArray(remoteDocs) || remoteDocs.length === 0) return false;
    const docs = readAll();
    let changed = false;

    for (const remote of remoteDocs) {
        if (!remote || typeof remote.id !== 'string') continue;
        const local = docs[remote.id];

        if (remote.deletedAt) {
            if (local && !local.deletedAt) {
                docs[remote.id] = { ...remote };
                changed = true;
            }
            continue;
        }

        const strategy = STRATEGIES[remote.id];
        if (!local || local.deletedAt) {
            docs[remote.id] = { ...remote };
            changed = true;
        } else if (strategy) {
            const merged = strategy(local.data, remote.data);
            if (JSON.stringify(merged) !== JSON.stringify(local.data)) {
                // Keep the newer stamp so the union is what gets pushed back.
                docs[remote.id] = {
                    id: remote.id,
                    data: merged,
                    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
                    deletedAt: null
                };
                changed = true;
            }
        } else if ((remote.updatedAt || 0) > (local.updatedAt || 0)) {
            docs[remote.id] = { ...remote };
            changed = true;
        }
    }

    if (changed) writeAll(docs);
    return changed;
}
