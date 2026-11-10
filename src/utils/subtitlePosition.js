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

// Resizing. The box is centred, so dragging one side moves both: a pointer
// 100px further out widens the box by 200. Percentages, because the picture
// changes size with the window and a px width would stop fitting.
export const MIN_WIDTH_PCT = 20;
export const MAX_WIDTH_PCT = 100;

export function widthPctFrom({ pointerX, centreX, areaWidth }) {
    if (!areaWidth) return MAX_WIDTH_PCT;
    const halfWidth = Math.abs(pointerX - centreX);
    const pct = Math.round((halfWidth * 2 / areaWidth) * 100);
    return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, pct));
}

export const MIN_FONT = 10;
// 72 was the ceiling and it was not enough on a desktop window, where the
// picture is several times a phone's and the viewer may be across the room.
export const MAX_FONT = 144;

// Corners scale the whole subtitle as one object — box, background and text
// together — the way a corner handle behaves in any editor. Sides stretch
// just the width; corners keep the proportions.
//
// The ratio is clamped before it is applied rather than clamping width and
// size separately: letting one hit its limit while the other kept going is
// what makes a "proportional" handle stop being proportional, and the text
// then creeps out of its own box.
export function scaleFrom({ pointerX, centreX, startHalfWidth, startWidthPct, startFont }) {
    const half = Math.max(8, Math.abs(pointerX - centreX));
    const base = Math.max(8, startHalfWidth);

    const lowest = Math.max(MIN_WIDTH_PCT / startWidthPct, MIN_FONT / startFont);
    const highest = Math.min(MAX_WIDTH_PCT / startWidthPct, MAX_FONT / startFont);
    const ratio = Math.min(highest, Math.max(lowest, half / base));

    return {
        widthPct: Math.round(startWidthPct * ratio),
        fontSize: Math.round(startFont * ratio)
    };
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
