// Playing on to the next episode when one ends.

export const COUNTDOWN_SECONDS = 5;

export function nextInOrder(visibleFiles, current) {
    if (!Array.isArray(visibleFiles) || visibleFiles.length === 0) return null;
    const at = visibleFiles.indexOf(current);
    if (at < 0) return null;            // not in view; nothing to follow it
    if (at === visibleFiles.length - 1) return null;  // the end is the end
    return visibleFiles[at + 1];
}

// `marking` means a range selection is part-made — an A point set with no B
// yet. Moving the file out from under that loses the work. It deliberately
// does NOT mean "the editor is open": the editor is a mode the viewer sits in
// for as long as the user likes, and gating on that switched the whole feature
// off for anyone who had ever opened it.
export function shouldOfferNext({ enabled, marking, visibleFiles, current }) {
    if (!enabled || marking) return null;
    return nextInOrder(visibleFiles, current);
}

// An absolute deadline, not a counter that gets decremented. The viewer
// re-renders constantly while a video plays, and a counter driven from an
// effect can be torn down and re-armed by that churn before it ever reaches
// zero — a countdown frozen at 5 forever. A deadline cannot be moved by a
// re-render.
export function deadlineFrom(now) {
    return now + COUNTDOWN_SECONDS * 1000;
}

export function secondsLeft(deadline, now) {
    return Math.max(0, Math.ceil((deadline - now) / 1000));
}
