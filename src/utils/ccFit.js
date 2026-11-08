// Keeping subtitles inside their allowance on a phone.
//
// The size slider used to set the rendered size directly, so turning it up
// made the block taller until eight lines of dialogue covered the picture
// and the thing you were reading the subtitles *for* was gone. The slider
// is a wish now: this works out what actually fits.

// Where the subtitle should live, given how much black the video leaves.
// Over the picture when it fills the screen; in the empty space below it
// when there is enough — on a portrait phone that is most of the screen.
export function ccPlacement({ screenHeight, videoHeight, minBelow = 92 }) {
    const below = Math.max(0, (screenHeight - videoHeight) / 2);
    return below >= minBelow
        ? { mode: 'below', allowance: Math.round(below) }
        // Overlaying, never more than this much of the picture.
        : { mode: 'over', allowance: Math.round(videoHeight * 0.34) };
}

// Rough height of a block of text at a given size, in px.
export function blockHeight({ chars, charsPerLine, fontSize, lineHeight = 1.25 }) {
    if (chars <= 0) return 0;
    const perLine = Math.max(1, charsPerLine);
    return Math.ceil(chars / perLine) * fontSize * lineHeight;
}

// The largest size, up to what was asked for, whose text fits the allowance.
// Never below MIN_SIZE: unreadably small is its own failure, and at that
// point the block is allowed to scroll instead.
export const MIN_SIZE = 11;

export function fitFontSize({ wanted, chars, widthPx, allowance, lineHeight = 1.25 }) {
    for (let size = Math.round(wanted); size >= MIN_SIZE; size -= 1) {
        // A character is roughly 0.55 of the font size wide for Latin; CJK
        // is nearer 1.0, so this errs toward wrapping sooner, which is the
        // safe direction.
        const charsPerLine = Math.floor(widthPx / (size * 0.62));
        if (blockHeight({ chars, charsPerLine, fontSize: size, lineHeight }) <= allowance) {
            return size;
        }
    }
    return MIN_SIZE;
}
