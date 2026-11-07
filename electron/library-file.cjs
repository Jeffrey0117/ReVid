// One .revid per folder holding everything ReVid knows about the videos in
// it — subtitles, translations, playback position. A folder gains exactly one
// file no matter how many videos are in it, instead of two or three sidecars
// per video.
//
// The format is the existing "virtual video" idea widened: a small file that
// stands in for the heavy one. `source` is reserved for the step after this,
// where an entry points at a cloud copy instead of a local file.
const fs = require('fs');
const path = require('path');

const VERSION = 2;
const TYPE = 'revid-library';

// Cues are stored as tuples, not objects. An episode is ~700 lines and keys
// repeated 700 times is most of the file.
const packCue = (c) => (c.zh ? [c.start, c.end, c.text, c.zh] : [c.start, c.end, c.text]);
const unpackCue = (a) => ({ start: a[0], end: a[1], text: a[2], ...(a[3] ? { zh: a[3] } : {}) });

function libraryPathFor(folder) {
    return path.join(folder, `${path.basename(folder)}.revid`);
}

function emptyLibrary(folder) {
    return { v: VERSION, type: TYPE, folder: path.basename(folder), updatedAt: Date.now(), videos: {} };
}

function read(folder) {
    if (!folder) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(libraryPathFor(folder), 'utf8'));
        if (raw?.type !== TYPE || typeof raw.videos !== 'object') return emptyLibrary(folder);
        return raw;
    } catch (e) {
        return emptyLibrary(folder);
    }
}

// Written through a temp file: a half-written library would lose every
// video's subtitles at once, which a per-video sidecar could never do.
function write(folder, lib) {
    const target = libraryPathFor(folder);
    const tmp = `${target}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify({ ...lib, updatedAt: Date.now() }), 'utf8');
        fs.renameSync(tmp, target);
        return { success: true, path: target };
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* nothing written */ }
        return { success: false, error: e.message };
    }
}

// Entries are keyed by filename: unique within a folder, and it survives the
// folder being moved or renamed, which a full path would not.
const keyFor = (videoPath) => path.basename(videoPath);

function sizeOf(videoPath) {
    try { return fs.statSync(videoPath).size; } catch (e) { return 0; }
}

// Subtitles that already exist beside a video are imported once so nothing
// is lost when a folder starts using a library. The .srt is left in place —
// it is the user's file to delete.
function importLegacySidecars(folder, lib) {
    let changed = false;
    let names;
    try { names = fs.readdirSync(folder); } catch (e) { return false; }

    const parseSrt = require('./srt.cjs').parse;
    for (const name of names) {
        if (!/\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(name)) continue;
        if (lib.videos[name]?.subs) continue;
        const base = path.join(folder, name.replace(/\.[^.]+$/, ''));
        let cues = null;
        try { cues = parseSrt(fs.readFileSync(`${base}.srt`, 'utf8')); } catch (e) { continue; }
        if (!cues?.length) continue;

        let zh = null;
        try { zh = parseSrt(fs.readFileSync(`${base}.zh.srt`, 'utf8')); } catch (e) { /* none */ }
        if (zh && zh.length === cues.length) {
            cues = cues.map((c, i) => ({ ...c, zh: zh[i].text }));
        }
        lib.videos[name] = {
            ...(lib.videos[name] || {}),
            name,
            size: sizeOf(path.join(folder, name)),
            subs: cues.map(packCue)
        };
        changed = true;
    }
    return changed;
}

function getEntry(videoPath) {
    const folder = path.dirname(videoPath);
    const lib = read(folder);
    return lib.videos[keyFor(videoPath)] || null;
}

function getSubtitles(videoPath) {
    const entry = getEntry(videoPath);
    if (!entry?.subs?.length) return null;
    // A changed size used to discard these outright, on the theory that the
    // file had been replaced. Re-encoding and re-downloading change the size
    // too, and the cost of being wrong was hours of transcription thrown away
    // and silently redone on every folder open. Hand them back and let
    // subtitlesStale() say they are worth a second look.
    return entry.subs.map(unpackCue);
}

// The file is not the size it was when these were written. Usually a
// re-encode; occasionally a different episode under the same name.
function subtitlesStale(videoPath) {
    const entry = getEntry(videoPath);
    if (!entry?.subs?.length || !entry.size) return false;
    return entry.size !== sizeOf(videoPath);
}

function setSubtitles(videoPath, cues) {
    const folder = path.dirname(videoPath);
    const lib = read(folder);
    const key = keyFor(videoPath);
    lib.videos[key] = {
        ...(lib.videos[key] || {}),
        name: key,
        size: sizeOf(videoPath),
        subs: (cues || []).map(packCue)
    };
    return write(folder, lib);
}

// Translations arrive after the transcript and must line up with it.
function setTranslation(videoPath, zhTexts) {
    const folder = path.dirname(videoPath);
    const lib = read(folder);
    const key = keyFor(videoPath);
    const entry = lib.videos[key];
    if (!entry?.subs) return { success: false, error: 'No subtitles to translate' };
    entry.subs = entry.subs.map((tuple, i) => (
        zhTexts[i] ? [tuple[0], tuple[1], tuple[2], zhTexts[i]] : tuple.slice(0, 3)
    ));
    return write(folder, lib);
}

function clearSubtitles(videoPath, { alsoTranslation = true } = {}) {
    const folder = path.dirname(videoPath);
    const lib = read(folder);
    const key = keyFor(videoPath);
    if (!lib.videos[key]) return { success: true };
    if (alsoTranslation) delete lib.videos[key].subs;
    else if (lib.videos[key].subs) {
        lib.videos[key].subs = lib.videos[key].subs.map(t => t.slice(0, 3));
    }
    return write(folder, lib);
}

function setProgress(videoPath, progress) {
    const folder = path.dirname(videoPath);
    const lib = read(folder);
    const key = keyFor(videoPath);
    lib.videos[key] = { ...(lib.videos[key] || { name: key }), progress };
    return write(folder, lib);
}

// What an episode is about, which the dialogue never states out loud. Written
// in one pass for a whole folder so the file is not rewritten 24 times.
function setEpisodeGuide(folder, byName) {
    const lib = read(folder);
    let applied = 0;
    for (const [name, guide] of Object.entries(byName)) {
        if (!guide) continue;
        lib.videos[name] = { ...(lib.videos[name] || { name }), guide };
        applied += 1;
    }
    const r = write(folder, lib);
    return r.success ? { ...r, applied } : r;
}

// Transcribing a folder costs real minutes of CPU per episode, so it is
// something a folder is opted into, not something that happens because it
// was opened. Stored per folder so the choice survives restarts.
function setFollow(folder, on) {
    const lib = read(folder);
    lib.follow = Boolean(on);
    return write(folder, lib);
}

function getFollow(folder) {
    try { return Boolean(read(folder).follow); } catch (e) { return false; }
}

// Show-level facts live on the folder that holds the seasons, which has no
// videos of its own — so this is the one thing in a library not keyed by file.
function setShow(folder, show) {
    const lib = read(folder);
    lib.show = show;
    return write(folder, lib);
}

function getShow(folder) {
    try { return read(folder).show || null; } catch (e) { return null; }
}

// Bring a folder's library up to date on open: create it if missing, pull in
// any sidecars written before the library existed.
function ensureLibrary(folder) {
    if (!folder || !fs.existsSync(folder)) return { success: false, error: 'No folder' };
    const lib = read(folder);
    const imported = importLegacySidecars(folder, lib);
    if (imported || !fs.existsSync(libraryPathFor(folder))) {
        const r = write(folder, lib);
        return { ...r, imported };
    }
    return { success: true, imported: false };
}

module.exports = {
    VERSION,
    TYPE,
    libraryPathFor,
    read,
    write,
    ensureLibrary,
    getEntry,
    getSubtitles,
    subtitlesStale,
    setSubtitles,
    setTranslation,
    clearSubtitles,
    setProgress,
    setEpisodeGuide,
    setShow,
    getShow,
    setFollow,
    getFollow,
    packCue,
    unpackCue
};
