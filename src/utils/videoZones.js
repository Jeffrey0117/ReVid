// The picture split into three strips: a side for the previous episode, the
// middle left alone for the player's own click-to-pause, a side for the next.
//
// A third each side is deliberately generous. These are hit by a pointer that
// is already moving, often without looking, and the only thing on the other
// side of a mistake is pausing — the sides never do anything destructive.

export const SIDE_FRACTION = 1 / 3;

// Where the picture actually is inside the element.
//
// A <video> with object-fit: contain fills its box, but the picture inside it
// only fills one dimension — the rest is letterbox. Anything pinned to the
// element's edges therefore floats out in the black: in a tall narrow window
// a 16:9 video drew its picture 168px tall inside a 1016px element, and a
// strip pinned to the bottom sat eight hundred pixels below what it referred
// to.
export function pictureBox({ elW, elH, videoW, videoH }) {
    const box = { left: 0, top: 0, width: elW, height: elH };
    if (!(elW > 0) || !(elH > 0) || !(videoW > 0) || !(videoH > 0)) return box;

    const scale = Math.min(elW / videoW, elH / videoH);
    const width = videoW * scale;
    const height = videoH * scale;
    return {
        left: (elW - width) / 2,
        top: (elH - height) / 2,
        width,
        height
    };
}

export function zoneAt(x, width) {
    if (!width || !Number.isFinite(x) || !Number.isFinite(width)) return 'middle';
    const edge = width * SIDE_FRACTION;
    if (x < edge) return 'left';
    if (x > width - edge) return 'right';
    return 'middle';
}
