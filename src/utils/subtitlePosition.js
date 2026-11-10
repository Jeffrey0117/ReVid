// Now a thin adapter over subtitle-overlay-kit — see cueChunks.js for why.
//
// fitInside and maxOffsetFor are new in the kit and were not in ReVid's own
// version: the first pulls the box back into frame after the window shrinks
// under it, the second replaces the hardcoded slider ceiling that could not
// reach the top of a desktop window.

export {
    clampTop,
    anchorToTop,
    dropAnchor,
    fitInside,
    widthPctFrom,
    scaleFrom,
    maxOffsetFor,
    DRAG_THRESHOLD,
    MIN_WIDTH_PCT,
    MAX_WIDTH_PCT,
    MIN_FONT,
    MAX_FONT
} from '../../electron/vendor/subtitle-overlay-kit.js';
