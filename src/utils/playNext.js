// Which video follows this one when the current one ends.
//
// Not the same question as the `n` key answers. That walks the raw folder
// listing and wraps around at the end; this walks the list actually on
// screen — filtered, sorted, pinned-only — because advancing to a file the
// viewer cannot see reads as the player losing its place. And it stops at
// the end rather than looping back to episode one, which is a surprise
// nobody wants after a season finale.

export const COUNTDOWN_SECONDS = 5;

export function nextInOrder(visibleFiles, current) {
    if (!Array.isArray(visibleFiles) || visibleFiles.length === 0) return null;
    const at = visibleFiles.indexOf(current);
    if (at < 0) return null;            // not in view; nothing to follow it
    if (at === visibleFiles.length - 1) return null;  // the end is the end
    return visibleFiles[at + 1];
}

// Whether the player should offer to continue at all. Kept here so the
// conditions are in one place and testable rather than spread across a
// component's render.
export function shouldOfferNext({ enabled, editing, visibleFiles, current }) {
    if (!enabled || editing) return null;
    return nextInOrder(visibleFiles, current);
}
