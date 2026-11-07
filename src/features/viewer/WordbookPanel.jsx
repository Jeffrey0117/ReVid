import { useState, useCallback } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { readWordbook, removeWord } from './WordLookup';

const TAG_LABELS = { cet4: 'CET4', cet6: 'CET6', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE' };

const getElectronAPI = () => window.electronAPI || null;

function toCsv(words) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['word', 'phonetic', 'definition', 'tags', 'example', 'addedAt'];
    const rows = words.map(w => [
        w.word, w.phonetic, w.definition, (w.tags || []).join(' '), w.example,
        w.addedAt ? new Date(w.addedAt).toISOString().slice(0, 10) : ''
    ].map(esc).join(','));
    return [head.join(','), ...rows].join('\n');
}

// Everything collected while watching, in one place: review it, drop what you
// have learned, take it out as CSV for Anki or a spreadsheet.
export const WordbookPanel = ({ onClose, onSeekToExample }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [words, setWords] = useState(readWordbook);
    const [query, setQuery] = useState('');

    const drop = useCallback((word) => {
        setWords(removeWord(word));
    }, []);

    const exportCsv = useCallback(async () => {
        const api = getElectronAPI();
        const csv = toCsv(words);
        if (api?.savePdf) {
            // savePdf writes arbitrary bytes; the dialog filter is the only
            // PDF-specific part, so a CSV needs its own small path.
            const bytes = new TextEncoder().encode('﻿' + csv); // BOM for Excel
            const result = await api.saveTextFile?.(Array.from(bytes), 'revid-wordbook.csv');
            if (result?.success) return;
        }
        // Fallback: clipboard, so the data is never trapped.
        try { await navigator.clipboard.writeText(csv); } catch (e) { /* denied */ }
    }, [words]);

    const shown = query
        ? words.filter(w =>
            w.word.toLowerCase().includes(query.toLowerCase())
            || (w.definition || '').includes(query))
        : words;

    return (
        <div style={{
            width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: theme.bgSecondary, borderLeft: `1px solid ${theme.border}`
        }}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderBottom: `1px solid ${theme.border}`
            }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
                    {t('wordbookTitle')} ({words.length})
                </span>
                <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 16, padding: '0 4px' }}>
                    {'✕'}
                </button>
            </div>

            {words.length > 0 && (
                <div style={{ padding: '8px 14px 0' }}>
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('wordbookSearch')}
                        style={{
                            width: '100%', padding: '5px 8px', borderRadius: 5, fontSize: 12,
                            background: theme.inputBg, color: theme.text,
                            border: `1px solid ${theme.borderSecondary}`
                        }}
                    />
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                {words.length === 0 && (
                    <div style={{ padding: '20px 14px', fontSize: 12, color: theme.textTertiary, lineHeight: 1.6 }}>
                        {t('wordbookEmpty')}
                    </div>
                )}
                {shown.map((w) => (
                    <div
                        key={w.word}
                        style={{
                            padding: '8px 14px',
                            borderBottom: `1px solid ${theme.border}`
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                                {w.word}
                            </span>
                            {w.phonetic && (
                                <span style={{ fontSize: 11, color: theme.textTertiary }}>/{w.phonetic}/</span>
                            )}
                            <div style={{ flex: 1 }} />
                            <button
                                title={t('wordbookRemove')}
                                onClick={() => drop(w.word)}
                                style={{ color: theme.textTertiary, fontSize: 13 }}
                            >
                                {'✕'}
                            </button>
                        </div>

                        {w.tags?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                {w.tags.map(tag => (
                                    <span key={tag} style={{
                                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                                        background: theme.accentBg, color: theme.accent
                                    }}>
                                        {TAG_LABELS[tag] || tag.toUpperCase()}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4, color: theme.textSecondary }}>
                            {w.definition}
                        </div>

                        {w.example && (
                            <div
                                onClick={() => onSeekToExample?.(w.example)}
                                title={onSeekToExample ? t('wordbookJump') : undefined}
                                style={{
                                    fontSize: 11, lineHeight: 1.5, marginTop: 4,
                                    color: theme.textTertiary, fontStyle: 'italic',
                                    cursor: onSeekToExample ? 'pointer' : 'default'
                                }}
                            >
                                “{w.example}”
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {words.length > 0 && (
                <div style={{ padding: '10px 14px', borderTop: `1px solid ${theme.border}` }}>
                    <button
                        onClick={exportCsv}
                        style={{
                            width: '100%', padding: '6px 0', borderRadius: 6, fontSize: 12,
                            background: theme.inputBg, color: theme.textSecondary
                        }}
                    >
                        {t('wordbookExportCsv')}
                    </button>
                </div>
            )}
        </div>
    );
};
