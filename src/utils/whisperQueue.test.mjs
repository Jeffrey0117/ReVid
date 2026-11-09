import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWhisperQueue, PRIORITY } = require('../../electron/whisper-queue.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The queue skips anything that is not on disk, so the fixtures have to be.
function files(dir, names) {
    fs.mkdirSync(dir, { recursive: true });
    return names.map((n) => {
        const p = path.join(dir, n);
        fs.writeFileSync(p, Buffer.alloc(8));
        return p;
    });
}

// A queue that records what it was asked to run, and holds each job open so
// the ordering of what is still waiting can be inspected.
function harness({ has = () => false } = {}) {
    const ran = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const q = createWhisperQueue({
        runJob: async (p) => { ran.push(p); await gate; return { success: true }; },
        hasSubtitles: has,
        onEvent: () => {}
    });
    return { q, ran, release };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'revid-q-'));
const settle = () => new Promise(r => setTimeout(r, 15));

test('priorities are ordered so the open folder beats the other seasons', () => {
    assert.ok(PRIORITY.HIGH < PRIORITY.LOW, 'what is playing must come first');
    assert.ok(PRIORITY.LOW < PRIORITY.IDLE, 'the open folder must beat other seasons');
});

test('the video being watched jumps the queue', async () => {
    const dir = tmp();
    try {
        const [a, b, c] = files(dir, ['a.mp4', 'b.mp4', 'c.mp4']);
        const [watching] = files(dir, ['watching.mp4']);
        const { q, ran, release } = harness();

        q.enqueueFolder([a, b, c], PRIORITY.LOW);
        await settle();
        assert.equal(ran[0], a, 'the first job should already be running');

        q.enqueue(watching, PRIORITY.HIGH);
        release();
        await settle();
        // b and c were queued first, but the watched video outranks them.
        assert.equal(ran[1], watching, `ran: ${ran.map(p => path.basename(p)).join(', ')}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// Opening one season used to queue only that season, so a show was never
// finished unless every folder was visited by hand.
test('other seasons are queued, but behind the one in hand', async () => {
    const root = tmp();
    try {
        const other = files(path.join(root, 's6'), ['x.mp4', 'y.mp4']);
        const open = files(path.join(root, 's2'), ['a.mp4', 'b.mp4']);
        const { q, ran, release } = harness();

        q.enqueueFolder(other, PRIORITY.IDLE);
        await settle();
        q.enqueueFolder(open, PRIORITY.LOW);
        release();
        await settle();

        const order = ran.map(p => path.basename(path.dirname(p)) + '/' + path.basename(p));
        // s6/x was already running; everything after it is the open season.
        assert.equal(order[1], 's2/a.mp4', `order: ${order.join(' ')}`);
        assert.equal(order[2], 's2/b.mp4', `order: ${order.join(' ')}`);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('episodes that already have subtitles are never queued', async () => {
    const dir = tmp();
    try {
        const [d1, n1, d2] = files(dir, ['done1.mp4', 'new.mp4', 'done2.mp4']);
        const done = new Set([d1, d2]);
        const { q } = harness({ has: (p) => done.has(p) });
        assert.equal(q.enqueueFolder([d1, n1, d2], PRIORITY.IDLE), 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// A sweep that runs on every folder open, and again on launch, must not
// pile the same work up repeatedly.
test('sweeping the same folder twice does not double the work', async () => {
    const dir = tmp();
    try {
        const list = files(dir, ['a.mp4', 'b.mp4', 'c.mp4']);
        const { q } = harness();
        q.enqueueFolder(list, PRIORITY.IDLE);
        await settle();
        assert.equal(q.enqueueFolder(list, PRIORITY.IDLE), 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('clearing drops what is waiting', async () => {
    const dir = tmp();
    try {
        const list = files(dir, ['a.mp4', 'b.mp4', 'c.mp4']);
        const { q } = harness();
        q.enqueueFolder(list, PRIORITY.IDLE);
        await settle();
        q.clearPending();
        assert.equal(q.status().pending, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
