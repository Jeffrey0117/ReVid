// The word list must survive two machines editing it. Whole-document
// last-write-wins would silently drop one side's additions, so this checks
// the per-item merge actually converges.
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Minimal localStorage so the module under test can run outside a browser.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
};

const mod = await import('../docsStore.js');
const { readDoc, writeDoc, applyRemoteDocs, collectDirtyDocs, DOC_IDS } = mod;

const reset = () => store.clear();
const wordsOf = () => (readDoc(DOC_IDS.WORDBOOK)?.words || []).filter(w => !w.removed).map(w => w.word).sort();

test('additions from both machines survive', () => {
    reset();
    writeDoc(DOC_IDS.WORDBOOK, { words: [{ word: 'local', updatedAt: 100 }] });
    applyRemoteDocs([{
        id: DOC_IDS.WORDBOOK, updatedAt: 200, deletedAt: null,
        data: { words: [{ word: 'remote', updatedAt: 150 }] }
    }]);
    assert.deepEqual(wordsOf(), ['local', 'remote']);
});

test('a newer edit of the same word wins', () => {
    reset();
    writeDoc(DOC_IDS.WORDBOOK, { words: [{ word: 'cat', note: 'old', updatedAt: 100 }] });
    applyRemoteDocs([{
        id: DOC_IDS.WORDBOOK, updatedAt: 300, deletedAt: null,
        data: { words: [{ word: 'cat', note: 'new', updatedAt: 200 }] }
    }]);
    const cat = readDoc(DOC_IDS.WORDBOOK).words.find(w => w.word === 'cat');
    assert.equal(cat.note, 'new');
});

test('a deletion is not resurrected by a machine that still has the word', () => {
    reset();
    writeDoc(DOC_IDS.WORDBOOK, { words: [{ word: 'gone', removed: true, updatedAt: 500 }] });
    applyRemoteDocs([{
        id: DOC_IDS.WORDBOOK, updatedAt: 200, deletedAt: null,
        data: { words: [{ word: 'gone', updatedAt: 100 }] }
    }]);
    assert.deepEqual(wordsOf(), [], 'the older copy must not bring it back');
});

test('known words union, and the merge is pushed back', () => {
    reset();
    writeDoc(DOC_IDS.KNOWN_WORDS, { words: ['a', 'b'] });
    applyRemoteDocs([{
        id: DOC_IDS.KNOWN_WORDS, updatedAt: 999, deletedAt: null, data: { words: ['b', 'c'] }
    }]);
    assert.deepEqual(readDoc(DOC_IDS.KNOWN_WORDS).words.sort(), ['a', 'b', 'c']);
    // The union has to be dirty, or the other machine never learns about 'a'.
    assert.equal(collectDirtyDocs(0).some(d => d.id === DOC_IDS.KNOWN_WORDS), true);
});

test('converges: applying the same remote twice changes nothing more', () => {
    reset();
    writeDoc(DOC_IDS.WORDBOOK, { words: [{ word: 'x', updatedAt: 100 }] });
    const remote = [{
        id: DOC_IDS.WORDBOOK, updatedAt: 200, deletedAt: null,
        data: { words: [{ word: 'y', updatedAt: 150 }] }
    }];
    applyRemoteDocs(remote);
    const first = JSON.stringify(readDoc(DOC_IDS.WORDBOOK));
    const changed = applyRemoteDocs(remote);
    assert.equal(changed, false, 'second apply must be a no-op');
    assert.equal(JSON.stringify(readDoc(DOC_IDS.WORDBOOK)), first);
});

test('an unknown doc falls back to whole-record last-write-wins', () => {
    reset();
    writeDoc('learn-prefs', { level: 5000 });
    applyRemoteDocs([{ id: 'learn-prefs', updatedAt: Date.now() + 1000, deletedAt: null, data: { level: 9000 } }]);
    assert.equal(readDoc('learn-prefs').level, 9000);
    // …and an older remote loses.
    applyRemoteDocs([{ id: 'learn-prefs', updatedAt: 1, deletedAt: null, data: { level: 1 } }]);
    assert.equal(readDoc('learn-prefs').level, 9000);
});

test('only edits after the watermark are pushed', () => {
    reset();
    writeDoc(DOC_IDS.WORDBOOK, { words: [] });
    const stamp = readDoc(DOC_IDS.WORDBOOK) && collectDirtyDocs(0)[0].updatedAt;
    assert.equal(collectDirtyDocs(stamp).length, 0, 'nothing newer than its own stamp');
    assert.equal(collectDirtyDocs(stamp - 1).length, 1);
});
