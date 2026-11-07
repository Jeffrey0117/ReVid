import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const library = require('../../electron/library-file.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function folder() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'revid-follow-'));
}

test('a folder nobody has decided about is swept', () => {
    const dir = folder();
    try {
        // Subtitles are what the search, the reel export and the learning
        // features all stand on; waiting to be asked means they are never
        // there when they are wanted.
        assert.equal(library.getFollow(dir), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('switching a folder off is remembered', () => {
    const dir = folder();
    try {
        library.setFollow(dir, false);
        assert.equal(library.getFollow(dir), false);
        // And survives being read fresh, not just in this call.
        assert.equal(library.read(dir).follow, false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('switching it back on is remembered too', () => {
    const dir = folder();
    try {
        library.setFollow(dir, false);
        library.setFollow(dir, true);
        assert.equal(library.getFollow(dir), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a folder that cannot be read is treated as swept, not silently skipped', () => {
    // Failing closed here would mean transcription quietly never happening.
    assert.equal(library.getFollow(path.join(os.tmpdir(), 'revid-does-not-exist-xyz')), true);
});

test('the flag does not disturb what else the library holds', () => {
    const dir = folder();
    const video = path.join(dir, 'Show S01E01.mp4');
    try {
        fs.writeFileSync(video, Buffer.alloc(10));
        library.setSubtitles(video, [{ start: 0, end: 1, text: 'hi' }]);
        library.setFollow(dir, false);
        assert.equal(library.getSubtitles(video)?.length, 1);
        assert.equal(library.getFollow(dir), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
