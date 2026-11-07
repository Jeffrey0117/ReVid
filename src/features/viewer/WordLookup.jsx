import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';

const getElectronAPI = () => window.electronAPI || null;

const WORDBOOK_KEY = 'revid-wordbook';
const DIFFICULTY_KEY = 'revid-difficulty';
const KNOWN_KEY = 'revid-known-words';

// Whether marking happens at all is the viewer's mode, not a setting here —
// these are only the thresholds it uses once learning mode is on.
export const DEFAULT_DIFFICULTY = { tags: [], minFreqRank: 5000 };

// Words the user says they already know are never marked again.
export function readKnownWords() {
    try { return new Set(JSON.parse(localStorage.getItem(KNOWN_KEY)) || []); } catch { return new Set(); }
}

export function markWordKnown(base) {
    const known = readKnownWords();
    known.add(base);
    try { localStorage.setItem(KNOWN_KEY, JSON.stringify([...known])); } catch { /* full */ }
    return known;
}

export function unmarkWordKnown(base) {
    const known = readKnownWords();
    known.delete(base);
    try { localStorage.setItem(KNOWN_KEY, JSON.stringify([...known])); } catch { /* full */ }
    return known;
}

export function readDifficulty() {
    try {
        const saved = JSON.parse(localStorage.getItem(DIFFICULTY_KEY));
        return saved ? { ...DEFAULT_DIFFICULTY, ...saved } : { ...DEFAULT_DIFFICULTY };
    } catch {
        return { ...DEFAULT_DIFFICULTY };
    }
}

export function writeDifficulty(value) {
    try { localStorage.setItem(DIFFICULTY_KEY, JSON.stringify(value)); } catch { /* full */ }
}

export function readWordbook() {
    try { return JSON.parse(localStorage.getItem(WORDBOOK_KEY)) || []; } catch { return []; }
}

export function saveWord(entry) {
    const book = readWordbook();
    if (book.some(w => w.word === entry.word)) return book;
    const next = [...book, { ...entry, addedAt: Date.now() }];
    try { localStorage.setItem(WORDBOOK_KEY, JSON.stringify(next)); } catch { /* full */ }
    return next;
}

export function removeWord(word) {
    const next = readWordbook().filter(w => w.word !== word);
    try { localStorage.setItem(WORDBOOK_KEY, JSON.stringify(next)); } catch { /* full */ }
    return next;
}

const TAG_LABELS = { cet4: 'CET4', cet6: 'CET6', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE' };

// Definition card for one word, anchored near where it was clicked.
export const WordCard = ({ word, example, anchor, onClose, onKnown }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [entry, setEntry] = useState(undefined); // undefined = loading, null = not found
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const api = getElectronAPI();
        if (!api?.dictLookup) { setEntry(null); return; }
        api.dictLookup(word).then((r) => {
            if (cancelled) return;
            setEntry(r.success ? r.entry : null);
            if (r.entry) setSaved(readWordbook().some(w => w.word === r.entry.word));
        });
        return () => { cancelled = true; };
    }, [word]);

    const add = useCallback(() => {
        if (!entry) return;
        saveWord({
            word: entry.word,
            phonetic: entry.phonetic,
            definition: entry.definition,
            tags: entry.tags,
            rank: entry.rank,
            example: example || ''
        });
        setSaved(true);
    }, [entry, example]);

    // Keep the card on screen when the word is near an edge.
    const left = Math.min(Math.max(8, anchor.x - 130), window.innerWidth - 276);
    const top = anchor.y > window.innerHeight - 220 ? anchor.y - 200 : anchor.y + 22;

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'fixed', left, top, zIndex: 500,
                width: 268, padding: 14,
                background: theme.dialogBg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 10,
                boxShadow: '0 12px 36px rgba(0,0,0,0.45)'
            }}
        >
            {entry === undefined && (
                <div style={{ fontSize: 12, color: theme.textTertiary }}>{t('processing')}</div>
            )}

            {entry === null && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: theme.textSecondary }}>
                        {word} — {t('wordNotFound')}
                    </span>
                    <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 14 }}>{'✕'}</button>
                </div>
            )}

            {entry && (
                <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>{entry.word}</span>
                        {entry.phonetic && (
                            <span style={{ fontSize: 12, color: theme.textTertiary }}>/{entry.phonetic}/</span>
                        )}
                        <div style={{ flex: 1 }} />
                        <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 14 }}>{'✕'}</button>
                    </div>

                    {entry.inflected && (
                        <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
                            {entry.queried} → {entry.word}
                        </div>
                    )}

                    {entry.tags?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                            {entry.tags.map(tag => (
                                <span key={tag} style={{
                                    fontSize: 9, padding: '1px 5px', borderRadius: 3,
                                    background: theme.accentBg, color: theme.accent
                                }}>
                                    {TAG_LABELS[tag] || tag.toUpperCase()}
                                </span>
                            ))}
                        </div>
                    )}

                    <div style={{
                        fontSize: 13, lineHeight: 1.6, marginTop: 8, color: theme.textSecondary
                    }}>
                        {entry.definition}
                    </div>

                    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                        <button
                            onClick={saved ? undefined : add}
                            disabled={saved}
                            style={{
                                flex: 1, padding: '6px 0',
                                borderRadius: 6, fontSize: 12,
                                cursor: saved ? 'default' : 'pointer',
                                background: saved ? theme.inputBg : theme.accent,
                                color: saved ? theme.textTertiary : '#fff'
                            }}
                        >
                            {saved ? t('wordSaved') : t('wordAdd')}
                        </button>
                        {/* Frequency can't know what THIS reader knows, so let
                            them retire a word from marking by hand. */}
                        <button
                            title={t('wordKnownHint')}
                            onClick={() => { markWordKnown(entry.word); onKnown?.(entry.word); onClose(); }}
                            style={{
                                padding: '6px 10px', borderRadius: 6, fontSize: 12,
                                background: theme.inputBg, color: theme.textSecondary
                            }}
                        >
                            {t('wordKnown')}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

// Splits text into clickable word spans, underlining the ones flagged as
// above the learner's level.
export const ClickableText = ({ text, marks, onWordClick, style, markColor }) => {
    if (!text) return null;
    const parts = [];
    let cursor = 0;
    const sorted = [...(marks || [])].sort((a, b) => a.start - b.start);

    const pushPlain = (chunk, key) => {
        if (!chunk) return;
        // Plain runs are still word-clickable, just not highlighted.
        const tokens = chunk.split(/(\b[A-Za-z][A-Za-z'’-]*\b)/g);
        tokens.forEach((tok, i) => {
            if (/^[A-Za-z]/.test(tok) && tok.length >= 3) {
                parts.push(
                    <span
                        key={`${key}-${i}`}
                        onClick={(e) => { e.stopPropagation(); onWordClick(tok, e); }}
                        style={{ cursor: 'pointer' }}
                    >
                        {tok}
                    </span>
                );
            } else if (tok) {
                parts.push(<span key={`${key}-${i}`}>{tok}</span>);
            }
        });
    };

    for (const [i, m] of sorted.entries()) {
        if (m.start < cursor) continue; // overlapping match
        pushPlain(text.slice(cursor, m.start), `p${i}`);
        parts.push(
            <span
                key={`m${i}`}
                onClick={(e) => { e.stopPropagation(); onWordClick(m.word, e); }}
                style={{
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textDecorationColor: markColor,
                    textDecorationThickness: 2,
                    textUnderlineOffset: 2
                }}
            >
                {text.slice(m.start, m.end)}
            </span>
        );
        cursor = m.end;
    }
    pushPlain(text.slice(cursor), 'tail');

    return <span style={style}>{parts}</span>;
};
