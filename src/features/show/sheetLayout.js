// The episode sheet stacks a hero, a synopsis and the season's episode list
// inside one bounded card. Left alone, the list absorbed every bit of
// variation in synopsis length: a wordy episode left two rows visible, a
// terse one five. These are the bounds that stop that happening — exported
// so the rule can be tested rather than only looked at.

export const SHEET = {
    heroMaxPx: 210,
    // About five lines; longer synopses scroll inside the block rather than
    // pushing everything below them down.
    summaryMaxEm: 7.4,
    summaryLineHeight: 1.7,
    // The list never shrinks below this, whatever is above it.
    listMinPx: 170,
    rowPx: 32
};

// Pixels the blocks above the list take, for a given synopsis.
export function headerHeight({ summaryLines, hasHero = true }) {
    const em = 13.5; // the synopsis font size
    const lines = Math.max(1, summaryLines);
    const summary = Math.min(lines, SHEET.summaryMaxEm / SHEET.summaryLineHeight)
        * SHEET.summaryLineHeight * em;
    const titleBlock = 64;   // title + the date/length line
    const padding = 30;
    return (hasHero ? SHEET.heroMaxPx : 0) + titleBlock + Math.round(summary) + padding;
}

// How many episode rows are visible in a card of this height.
export function visibleRows(cardHeight, { summaryLines }) {
    const left = Math.max(
        SHEET.listMinPx,
        cardHeight - headerHeight({ summaryLines })
    );
    return Math.floor(left / SHEET.rowPx);
}
