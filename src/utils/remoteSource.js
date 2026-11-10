// Telling a file on this machine apart from a URL somewhere else.
//
// The player takes one `src` either way, so the decision has to happen in
// exactly one place: toLocalVideoUrl percent-encodes every path segment,
// which turns "https://host/a.m3u8" into "https:/%2Fhost%2Fa.m3u8" and a
// perfectly good URL into a 404 nobody can read.

// Explicit extension: Vite resolves without one, node --test does not, and
// the test for this file is what catches the URL-mangling bug it exists to
// prevent.
import { toLocalVideoUrl } from './localVideoUrl.js';

export function isRemoteSource(s) {
    return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
}

// HLS needs a library; a plain file does not. Query strings are common on
// signed stream URLs, so the extension is matched before them.
export function isHlsUrl(s) {
    if (typeof s !== 'string') return false;
    return /\.m3u8(\?|#|$)/i.test(s.trim());
}

export function toPlayableSrc(pathOrUrl) {
    if (!pathOrUrl) return null;
    return isRemoteSource(pathOrUrl) ? pathOrUrl.trim() : toLocalVideoUrl(pathOrUrl);
}

// A name to show and to save under, taken from the URL's last segment.
export function nameFromUrl(url) {
    if (!isRemoteSource(url)) return '';
    let parsed;
    try { parsed = new URL(url.trim()); } catch (e) { return ''; }
    const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const decoded = (() => {
        try { return decodeURIComponent(last); } catch (e) { return last; }
    })();
    // A stream's last segment is a playlist name, which says nothing about
    // what the video is; the folder above it usually does.
    if (/^(index|master|playlist|manifest)\.m3u8$/i.test(decoded)) {
        const parent = parsed.pathname.split('/').filter(Boolean).slice(-2)[0];
        if (parent) {
            try { return decodeURIComponent(parent); } catch (e) { return parent; }
        }
    }
    return decoded;
}

// What to save it as. HLS is many segments muxed into one file, so whatever
// the playlist was called, what lands on disk is an mp4.
export function downloadNameFor(url) {
    const base = nameFromUrl(url) || 'video';
    if (isHlsUrl(url)) return `${base.replace(/\.[^.]+$/, '')}.mp4`;
    return /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}.mp4`;
}
