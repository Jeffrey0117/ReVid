// The picture split into three strips: a side for the previous episode, the
// middle left alone for the player's own click-to-pause, a side for the next.
//
// A third each side is deliberately generous. These are hit by a pointer that
// is already moving, often without looking, and the only thing on the other
// side of a mistake is pausing — the sides never do anything destructive.

export const SIDE_FRACTION = 1 / 3;

export function zoneAt(x, width) {
    if (!width || !Number.isFinite(x) || !Number.isFinite(width)) return 'middle';
    const edge = width * SIDE_FRACTION;
    if (x < edge) return 'left';
    if (x > width - edge) return 'right';
    return 'middle';
}
