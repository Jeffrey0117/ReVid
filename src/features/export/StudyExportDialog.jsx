import { useState, useCallback, useMemo, useRef } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { parseSubtitles } from '../../utils/subtitles';
import { readWordbook, readDifficulty } from '../viewer/WordLookup';

const getElectronAPI = () => window.electronAPI || null;

const baseName = (p) => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

// Reads a video's subtitles (and translation, if any) off disk.
function loadCues(api, videoPath) {
    const sub = api.readSubtitles(videoPath);
    if (!sub) return [];
    const cues = parseSubtitles(sub.content, sub.format);
    const zh = api.readTranslatedSubtitles?.(videoPath);
    if (zh) {
        const zhCues = parseSubtitles(zh.content, 'srt');
        if (zhCues.length === cues.length) {
            return cues.map((c, i) => ({ ...c, zh: zhCues[i].text }));
        }
    }
    return cues;
}

export const StudyExportDialog = ({ files, currentVideo, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const api = getElectronAPI();

    const [kind, setKind] = useState('transcript'); // transcript | wordbook
    const [withTranslation, setWithTranslation] = useState(true);
    const [wordSource, setWordSource] = useState('auto'); // auto | saved
    const [selected, setSelected] = useState(() => new Set(currentVideo ? [currentVideo] : []));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(null);
    const lastClickedRef = useRef(-1);

    // Only videos that actually have subtitles can be exported.
    const rows = useMemo(() => (files || []).map((p) => ({
        path: p,
        name: p.split(/[\\/]/).pop(),
        hasSubs: Boolean(api?.readSubtitles?.(p))
    })), [files, api]);

    const toggle = useCallback((index, shiftKey) => {
        const row = rows[index];
        if (!row?.hasSubs) return;
        setSelected(prev => {
            const next = new Set(prev);
            const turningOn = !next.has(row.path);
            if (shiftKey && lastClickedRef.current >= 0) {
                const lo = Math.min(lastClickedRef.current, index);
                const hi = Math.max(lastClickedRef.current, index);
                for (let i = lo; i <= hi; i++) {
                    if (!rows[i].hasSubs) continue;
                    if (turningOn) next.add(rows[i].path);
                    else next.delete(rows[i].path);
                }
            } else if (turningOn) {
                next.add(row.path);
            } else {
                next.delete(row.path);
            }
            return next;
        });
        lastClickedRef.current = index;
    }, [rows]);

    const chosen = rows.filter(r => selected.has(r.path));

    const run = useCallback(async () => {
        if (!api || chosen.length === 0) return;
        setBusy(true);
        setError(null);
        setDone(null);
        try {
            // Imported lazily: react-pdf and the CJK font are a heavy payload
            // that most sessions never need.
            const [{ pdf }, { registerPdfFonts }, docs] = await Promise.all([
                import('@react-pdf/renderer'),
                import('./pdfFonts'),
                import('./documents.jsx')
            ]);
            registerPdfFonts();

            const title = chosen.length === 1
                ? baseName(chosen[0].path)
                : `${baseName(chosen[0].path)} +${chosen.length - 1}`;

            let element;
            let suffix;
            if (kind === 'transcript') {
                const sections = chosen.map(r => ({
                    title: baseName(r.path),
                    cues: loadCues(api, r.path)
                })).filter(s => s.cues.length > 0);
                if (sections.length === 0) throw new Error(t('exportNoSubs'));
                element = docs.TranscriptPdf({ title, sections, showTranslation: withTranslation });
                suffix = '-transcript';
            } else {
                let words;
                if (wordSource === 'saved') {
                    words = readWordbook();
                } else {
                    const settings = readDifficulty();
                    const all = [];
                    const seen = new Set();
                    for (const r of chosen) {
                        const res = await api.dictWordBank(loadCues(api, r.path), {
                            tags: settings.tags,
                            minFreqRank: settings.minFreqRank
                        });
                        if (!res.success) continue;
                        for (const w of res.words) {
                            if (seen.has(w.word)) continue;
                            seen.add(w.word);
                            all.push(w);
                        }
                    }
                    words = all;
                }
                if (words.length === 0) throw new Error(t('exportNoWords'));
                element = docs.WordbookPdf({ title, words });
                suffix = '-wordbook';
            }

            const blob = await pdf(element).toBlob();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const result = await api.savePdf(Array.from(bytes), `${title}${suffix}.pdf`);
            if (result.success) setDone(result.path);
            else if (!result.canceled) setError(result.error);
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setBusy(false);
        }
    }, [api, chosen, kind, withTranslation, wordSource, t]);

    const Choice = ({ value, current, onPick, children }) => (
        <button
            onClick={() => onPick(value)}
            style={{
                flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 12,
                background: current === value ? theme.accent : theme.inputBg,
                color: current === value ? '#fff' : theme.textSecondary
            }}
        >
            {children}
        </button>
    );

    return (
        <div style={{
            position: 'fixed', top: 32, left: 0, right: 0, bottom: 0, zIndex: 330,
            background: theme.overlayBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                width: 560, maxWidth: '92%', maxHeight: '84%',
                display: 'flex', flexDirection: 'column',
                background: theme.dialogBg, borderRadius: 12,
                border: `1px solid ${theme.border}`,
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 18px', borderBottom: `1px solid ${theme.border}`
                }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
                        {t('exportStudyTitle')}
                    </div>
                    <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 18, padding: '2px 8px' }}>
                        {'✕'}
                    </button>
                </div>

                <div style={{ padding: '12px 18px 0' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Choice value="transcript" current={kind} onPick={setKind}>
                            {t('exportKindTranscript')}
                        </Choice>
                        <Choice value="wordbook" current={kind} onPick={setKind}>
                            {t('exportKindWordbook')}
                        </Choice>
                    </div>
                    <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 6 }}>
                        {kind === 'transcript' ? t('exportKindTranscriptHint') : t('exportKindWordbookHint')}
                    </div>

                    {kind === 'transcript' && (
                        <label style={{
                            display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
                            fontSize: 12, color: theme.textSecondary, cursor: 'pointer'
                        }}>
                            <input
                                type="checkbox"
                                checked={withTranslation}
                                onChange={(e) => setWithTranslation(e.target.checked)}
                                style={{ accentColor: theme.accent }}
                            />
                            {t('exportWithTranslation')}
                        </label>
                    )}

                    {kind === 'wordbook' && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                            <Choice value="auto" current={wordSource} onPick={setWordSource}>
                                {t('exportWordsAuto')}
                            </Choice>
                            <Choice value="saved" current={wordSource} onPick={setWordSource}>
                                {t('exportWordsSaved')} ({readWordbook().length})
                            </Choice>
                        </div>
                    )}
                </div>

                {(kind === 'transcript' || wordSource === 'auto') && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px 0' }}>
                        <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 4 }}>
                            {t('exportPickVideos')}
                        </div>
                        {rows.map((row, i) => (
                            <div
                                key={row.path}
                                onClick={(e) => toggle(i, e.shiftKey)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '6px 4px', borderRadius: 4,
                                    cursor: row.hasSubs ? 'pointer' : 'default',
                                    opacity: row.hasSubs ? 1 : 0.4,
                                    userSelect: 'none',
                                    background: selected.has(row.path) ? theme.accentBg : 'transparent'
                                }}
                            >
                                <input
                                    type="checkbox" readOnly
                                    checked={selected.has(row.path)}
                                    disabled={!row.hasSubs}
                                    style={{ accentColor: theme.accent, pointerEvents: 'none' }}
                                />
                                <span style={{
                                    flex: 1, fontSize: 12, color: theme.textSecondary,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                }}>
                                    {row.name}
                                </span>
                                {!row.hasSubs && (
                                    <span style={{ fontSize: 10, color: theme.textTertiary }}>
                                        {t('exportNoSubsRow')}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ padding: '12px 18px', borderTop: `1px solid ${theme.border}` }}>
                    {error && (
                        <div style={{ fontSize: 12, color: theme.error, marginBottom: 8 }}>{error}</div>
                    )}
                    {done && (
                        <div style={{ fontSize: 12, color: theme.success, marginBottom: 8 }}>
                            {t('exportDone')}{' '}
                            <button
                                onClick={() => api.revealInFolder(done)}
                                style={{ color: theme.accent, textDecoration: 'underline' }}
                            >
                                {t('exportReveal')}
                            </button>
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <button className="btn btn-ghost" onClick={onClose}>{t('close')}</button>
                        <button
                            className="btn btn-primary"
                            disabled={busy || (wordSource === 'auto' && chosen.length === 0)}
                            onClick={run}
                        >
                            {busy ? t('processing') : t('exportBuildPdf')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
