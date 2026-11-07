// The player's subtitle settings describe text over a window on a desk. A
// burned vertical short is read on a phone, at arm's length, while scrolling —
// a different medium that wants a different weight of type.
//
// So the reel starts from the look already tuned in the user's AutoReel and
// plottr shorts, and takes from the player only the choices that travel:
// colour, and how far the line sits from the edge. Size follows the player
// relatively, not absolutely.

// Tuned against real footage in the user's short-form projects. 96px on a
// 1920-tall canvas is 5% of the height.
export const REEL_BASE_STYLE = {
    fontFamily: "'Noto Sans TC', sans-serif",
    fontWeight: 900,
    fontSize: 96,
    color: '#FFFFFF',
    strokeWidth: 8,
    strokeColor: '#000000',
    bottomPct: 22,
    maxCharsPerLine: 14,
    shadowOffsetY: 6,
    shadowBlur: 14,
    shadowOpacity: 0.9
};

// The player's own default size, the point at which the reel uses its base.
const PLAYER_BASE_FONT = 18;
const MIN_FONT = 40;
const MAX_FONT = 200;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function toReelStyle(playerStyle) {
    const s = playerStyle || {};

    const ratio = Number.isFinite(s.fontSize) && s.fontSize > 0
        ? s.fontSize / PLAYER_BASE_FONT
        : 1;
    const fontSize = clamp(Math.round(REEL_BASE_STYLE.fontSize * ratio), MIN_FONT, MAX_FONT);

    // An outline the user widened should still read as wider here, but one
    // they turned off cannot be honoured: with no panel behind it, unoutlined
    // text disappears the moment the footage goes pale.
    const strokeWidth = s.strokeWidth > 0
        ? clamp(Math.round(REEL_BASE_STYLE.strokeWidth + s.strokeWidth), 2, 24)
        : REEL_BASE_STYLE.strokeWidth;

    // The composition only places from the bottom, so "top" becomes a line
    // high in the frame rather than a different anchor.
    const bottomPct = s.position === 'top' ? 62 : REEL_BASE_STYLE.bottomPct;

    return {
        ...REEL_BASE_STYLE,
        fontSize,
        strokeWidth,
        bottomPct,
        color: s.color || REEL_BASE_STYLE.color,
        strokeColor: s.strokeColor || REEL_BASE_STYLE.strokeColor,
        // Scale the drop shadow with the type so it stays proportional.
        shadowOffsetY: Math.round(REEL_BASE_STYLE.shadowOffsetY * (fontSize / REEL_BASE_STYLE.fontSize)),
        shadowBlur: Math.round(REEL_BASE_STYLE.shadowBlur * (fontSize / REEL_BASE_STYLE.fontSize)),
        shadowOpacity: Number.isFinite(s.shadow)
            ? clamp(s.shadow, 0, 1)
            : REEL_BASE_STYLE.shadowOpacity
    };
}
