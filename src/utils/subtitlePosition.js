// Now a thin adapter over subtitle-overlay-kit — see cueChunks.js for why.
//
// fitInside and maxOffsetFor are new in the kit and were not in ReVid's own
// version: the first pulls the box back into frame after the window shrinks
// under it, the second replaces the hardcoded slider ceiling that could not
// reach the top of a desktop window.

import kit from '../../electron/vendor/subtitle-overlay-kit.cjs';

export const clampTop = kit.clampTop;
export const anchorToTop = kit.anchorToTop;
export const dropAnchor = kit.dropAnchor;
export const fitInside = kit.fitInside;
export const widthPctFrom = kit.widthPctFrom;
export const scaleFrom = kit.scaleFrom;
export const maxOffsetFor = kit.maxOffsetFor;
export const DRAG_THRESHOLD = kit.DRAG_THRESHOLD;
export const MIN_WIDTH_PCT = kit.MIN_WIDTH_PCT;
export const MAX_WIDTH_PCT = kit.MAX_WIDTH_PCT;
export const MIN_FONT = kit.MIN_FONT;
export const MAX_FONT = kit.MAX_FONT;
