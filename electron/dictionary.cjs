// Offline English→Chinese dictionary, backed by the ECDICT-derived word bank
// (28k headwords + 30k inflected forms, ~5MB). No network, no API key.
//
// Two jobs:
//   lookup(token)              — what does this word mean?
//   markDifficult(text, opts)  — which words here are above the learner's level?
const fs = require('fs');
const path = require('path');

// A word is "difficult" when it is rare ENOUGH first — exam word lists are
// full of basics like make/order, so a tag alone over-marks badly. Tags then
// narrow that set further rather than widening it.
const UNRANKED = 0;        // absent from the frequency list = very rare
const RARE_RANK = 15000;   // rarer than this counts even with no exam tag
const DEFAULT_FLOOR = 3000;

const TOKEN_PATTERN = /[A-Za-z][A-Za-z'’-]*/g;

let dict = null;

function dictPath() {
    // Packaged builds keep electron/ inside the asar; a plain read works
    // because this is data, not an executable.
    return path.join(__dirname, 'data', 'wordbank.json');
}

function loadDict() {
    if (!dict) {
        dict = JSON.parse(fs.readFileSync(dictPath(), 'utf8'));
    }
    return dict;
}

function isLoaded() {
    return dict !== null;
}

// Inflections resolve through the forms table; there is no stemmer, which is
// what makes "lied → lie" and "beeswax → (nothing)" both behave.
function findBase(token, d) {
    const lower = String(token).toLowerCase().replace(/’/g, "'").replace(/'s?$/, '');
    if (lower.length < 3) return null;
    return d.forms[lower] || (d.words[lower] ? lower : null);
}

function entryFor(base, d) {
    const e = d.words[base];
    if (!e) return null;
    return {
        word: base,
        phonetic: e.p || '',
        definition: e.t || e.s || '',
        tags: e.g || [],
        rank: e.f || 0
    };
}

function lookup(token) {
    const d = loadDict();
    const base = findBase(token, d);
    if (!base) return null;
    const entry = entryFor(base, d);
    if (!entry) return null;
    // Surface the inflection so the card can say "ran → run".
    const normalized = String(token).toLowerCase().replace(/’/g, "'").replace(/'s?$/, '');
    return { ...entry, queried: token, inflected: normalized !== base };
}

function isDifficult(entry, { tags, minFreqRank }) {
    const floor = minFreqRank > 0 ? minFreqRank : DEFAULT_FLOOR;
    const rareEnough = entry.rank === UNRANKED || entry.rank > floor;
    if (!rareEnough) return false;

    // Pure frequency mode: clearing the floor is enough.
    if (!tags || tags.length === 0) return minFreqRank > 0;

    // Exam mode: needs one of the selected tags, but very rare words count
    // even untagged.
    return entry.tags.some(t => tags.includes(t))
        || entry.rank === UNRANKED
        || entry.rank > RARE_RANK;
}

function isSentenceStart(text, index) {
    for (let i = index - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === ' ' || ch === '"' || ch === "'" || ch === '“' || ch === '‘' || ch === '(') continue;
        return ch === '.' || ch === '!' || ch === '?' || ch === '\n';
    }
    return true;
}

// Capitalised mid-sentence is almost always a name; multiple capitals is an
// acronym. Either way, not vocabulary worth marking.
function looksLikeProperNoun(token, text, index) {
    if (!/^[A-Z]/.test(token)) return false;
    if (/[A-Z]/.test(token.slice(1))) return true;
    return !isSentenceStart(text, index);
}

// Returns [{ word, start, end, entry }] for the difficult words in `text`.
function markDifficult(text, opts = {}) {
    const d = loadDict();
    const options = {
        tags: Array.isArray(opts.tags) ? opts.tags : ['toefl', 'ielts'],
        minFreqRank: Number.isFinite(opts.minFreqRank) ? opts.minFreqRank : DEFAULT_FLOOR
    };

    const hits = [];
    TOKEN_PATTERN.lastIndex = 0;
    let m;
    while ((m = TOKEN_PATTERN.exec(text)) !== null) {
        const token = m[0];
        if (looksLikeProperNoun(token, text, m.index)) continue;
        const base = findBase(token, d);
        if (!base) continue;
        const entry = entryFor(base, d);
        if (!entry || !isDifficult(entry, options)) continue;
        hits.push({ word: token, base, start: m.index, end: m.index + token.length, entry });
    }
    return hits;
}

// Difficult words across a whole cue list, each recorded once at its first
// appearance together with the line it came from — a cue IS the example
// sentence, so no sentence-boundary detection is needed.
function buildWordBank(cues, opts = {}) {
    const seen = new Set();
    const out = [];
    for (const cue of cues) {
        if (!cue || !cue.text) continue;
        for (const hit of markDifficult(cue.text, opts)) {
            if (seen.has(hit.base)) continue;
            seen.add(hit.base);
            out.push({
                ...hit.entry,
                example: cue.text,
                exampleZh: cue.zh || '',
                at: cue.start
            });
        }
    }
    return out;
}

module.exports = {
    loadDict,
    isLoaded,
    lookup,
    markDifficult,
    buildWordBank,
    DEFAULT_FLOOR
};
