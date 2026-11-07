// Run an async job over many items with a bounded number in flight.
//
// The segment scan used to decode one file's audio at a time. Audio-only
// decoding is mostly waiting on the disk, so a whole season went by with one
// core busy and the rest idle — and a whole show took long enough that nobody
// would run it.

// Results come back in the order the items were given, however they finished,
// so a caller can zip them against its own list.
async function parallelMap(items, limit, worker) {
    const results = new Array(items.length);
    if (items.length === 0) return results;

    const width = Math.max(1, Math.min(limit, items.length));
    let next = 0;
    let stopped = false;

    const run = async () => {
        while (!stopped) {
            const i = next;
            next += 1;
            if (i >= items.length) return;
            // A worker that signals a stop drains the rest rather than
            // leaving half the lanes running after a cancel.
            const outcome = await worker(items[i], i);
            if (outcome && outcome.__stop) { stopped = true; return; }
            results[i] = outcome;
        }
    };

    await Promise.all(Array.from({ length: width }, run));
    return results;
}

const STOP = { __stop: true };

module.exports = { parallelMap, STOP };
