// Now a thin adapter over subtitle-overlay-kit.
//
// The logic that used to live here — splitting an over-long cue into readable
// pieces, and moving difficulty marks into the piece they belong to — is the
// same logic a userscript or a browser extension needs to put the same
// subtitles on a web page. Keeping it in a ReVid source file meant each of
// those would have had to copy it, and copies drift: the LAN page carried its
// own slightly different version for weeks, which is exactly why long cues
// were readable on a phone and a seven-line slab in the player.
//
// The vendored copy lives under electron/ because that is what gets packaged;
// src/ does not. The names below are ReVid's — the kit's DEFAULT_MAX_LINES is
// re-exported as MAX_LINES so nothing in the app had to be renamed to adopt it.

import kit from '../../electron/vendor/subtitle-overlay-kit.cjs';

export const charsPerLine = kit.charsPerLine;
export const chunkText = kit.chunkText;
export const chunkAt = kit.chunkAt;
export const marksForChunk = kit.marksForChunk;
export const visibleCue = kit.visibleCue;
export const cueProgress = kit.cueProgress;
export const MAX_LINES = kit.DEFAULT_MAX_LINES;
