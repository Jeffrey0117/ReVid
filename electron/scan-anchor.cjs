// Where to look for the segment in the next file.
//
// A show's opening or ending sits at nearly the same place in every episode
// of a season — but not across seasons, where runtimes and credits change.
// A single anchor taken from the first three files of a whole-show scan is
// therefore right for season one and wrong for the other seven, and every
// one of those falls back to decoding the entire file: slower than having
// no anchor at all.
//
// So the anchor follows the scan: the median of the last few confident hits.

const WINDOW = 5;       // how many recent hits the anchor is drawn from
const MIN_HITS = 2;     // before this, there is nothing worth guessing from

function createAnchor({ window = WINDOW, minHits = MIN_HITS } = {}) {
    const recent = [];

    return {
        // A confident match teaches it where the segment currently lives.
        record(matchStart) {
            if (!Number.isFinite(matchStart)) return;
            recent.push(matchStart);
            if (recent.length > window) recent.shift();
        },

        // A miss is a signal the position has moved — most likely a new
        // season. Forget fast rather than insisting on a stale guess.
        miss() {
            if (recent.length) recent.shift();
        },

        // null means "no idea yet, decode the whole file".
        get() {
            if (recent.length < minHits) return null;
            const sorted = [...recent].sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length / 2)];
        },

        size() { return recent.length; }
    };
}

module.exports = { createAnchor, WINDOW, MIN_HITS };
