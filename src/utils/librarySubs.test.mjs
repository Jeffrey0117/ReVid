import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const library = require('../../electron/library-file.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A folder with one video and subtitles already stored for it.
function fixture({ shrinkFileBy = 0 } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revid-subs-'));
    const video = path.join(dir, 'Show S01E01.mp4');
    fs.writeFileSync(video, Buffer.alloc(5000));
    library.setSubtitles(video, [
        { start: 1, end: 2, text: 'first' },
        { start: 2, end: 3, text: 'second' }
    ]);
    // Re-encoding or re-downloading changes the size while the episode,
    // and therefore the transcript, stays the same.
    if (shrinkFileBy) fs.writeFileSync(video, Buffer.alloc(5000 - shrinkFileBy));
    return { dir, video };
}

test('subtitles come back for an untouched file', () => {
    const { dir, video } = fixture();
    try {
        assert.equal(library.getSubtitles(video)?.length, 2);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// Regression: a size mismatch discarded the transcript outright, so the
// background queue saw "no subtitles" and transcribed the episode again,
// every time the folder was opened, with nothing said about why.
test('a resized file keeps its transcript instead of silently losing it', () => {
    const { dir, video } = fixture({ shrinkFileBy: 1200 });
    try {
        const cues = library.getSubtitles(video);
        assert.ok(cues, 'transcript was discarded');
        assert.equal(cues.length, 2);
        assert.equal(cues[0].text, 'first');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('the mismatch is still reportable, just not destructive', () => {
    const same = fixture();
    const changed = fixture({ shrinkFileBy: 1200 });
    try {
        assert.equal(library.subtitlesStale(same.video), false);
        assert.equal(library.subtitlesStale(changed.video), true);
    } finally {
        fs.rmSync(same.dir, { recursive: true, force: true });
        fs.rmSync(changed.dir, { recursive: true, force: true });
    }
});

test('a file with no stored subtitles has none, stale or otherwise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revid-subs-'));
    const video = path.join(dir, 'Untouched S01E02.mp4');
    fs.writeFileSync(video, Buffer.alloc(100));
    try {
        assert.equal(library.getSubtitles(video), null);
        assert.equal(library.subtitlesStale(video), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
