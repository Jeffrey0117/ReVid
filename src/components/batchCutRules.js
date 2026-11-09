// Which rows the batch-cut dialog lets you tick, and when.
//
// Kept out of the component because the rule is the whole feature: get it
// wrong and a run that missed three files leaves them unreachable, with a
// full rescan of the folder as the only way back.

// A row that found a segment but was never cut is still work waiting to be
// done — including after the batch finishes, which is exactly when the user
// notices they forgot to tick it.
export function canToggleRow(phase, row, nothingToCut) {
    if (!row) return false;
    if (phase === 'setup') return true;
    if (phase === 'scanning' || phase === 'cutting') return false;
    // review and done behave the same: anything still merely 'found'.
    // 'alreadycut' is deliberately not toggleable — cutting a trimmed file
    // again is how twenty episodes lost three seconds each.
    return row.status === 'found' && !nothingToCut(row);
}

// Rows a "cut these too" pass would act on.
export function pendingRows(rows, nothingToCut) {
    return (rows || []).filter(
        r => r.selected && r.status === 'found' && !nothingToCut(r)
    );
}

// Rows that found something but were left behind by the run that just ended.
export function missedRows(rows, nothingToCut) {
    return (rows || []).filter(
        r => r.status === 'found' && !nothingToCut(r)
    );
}
