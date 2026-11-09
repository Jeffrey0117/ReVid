// Dragging the subtitle box around the video.
//
// The stored form is an edge plus a distance from it ({ position: 'top' |
// 'bottom', offset: px }), which is what CSS wants and what survives a window
// resize. Dragging works in absolute tops, so these convert between the two.

// Below this, a press-and-release is a click (look the word up), not a drag.
export const DRAG_THRESHOLD = 4;

export function clampTop({ top, boxHeight, areaHeight }) {
    const limit = Math.max(0, areaHeight - boxHeight);
    if (!Number.isFinite(top)) return 0;
    return Math.min(limit, Math.max(0, top));
}

// Where the box currently sits, measured from the top of the video area.
export function anchorToTop({ position, offset, boxHeight, areaHeight }) {
    const raw = position === 'top' ? offset : areaHeight - boxHeight - offset;
    return clampTop({ top: raw, boxHeight, areaHeight });
}

// Which edge a dropped box should hang from. Whichever half it landed in wins:
// a subtitle parked near the top should stay near the top when the window
// changes size, and it only does that if it is anchored to the top.
export function dropAnchor({ top, boxHeight, areaHeight }) {
    const settled = clampTop({ top, boxHeight, areaHeight });
    const centre = settled + boxHeight / 2;
    if (centre < areaHeight / 2) {
        return { position: 'top', offset: Math.round(settled) };
    }
    return { position: 'bottom', offset: Math.round(Math.max(0, areaHeight - boxHeight - settled)) };
}
