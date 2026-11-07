import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';

const getElectronAPI = () => window.electronAPI || null;

const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
};

const episodeOf = (name) => name.replace(/\.[^.]+$/, '');

// Highlights the matched run without building HTML from user input.
function Highlighted({ text, query, color }) {
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0 || !query) return text;
    return (
        <>
            {text.slice(0, at)}
            <mark style={{ background: 'transparent', color, fontWeight: 700 }}>
                {text.slice(at, at + query.length)}
            </mark>
            {text.slice(at + query.length)}
        </>
    );
}

// Searching every transcript in the library: the answer to "which episode had
// the bit about X", without scrubbing through six hours of video.
export const TranscriptSearch = ({ folder, onPick, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [query, setQuery] = useState('');
    const [scope, setScope] = useState('folder');
    const [state, setState] = useState({ results: [], busy: false, ran: false });
    const [guide, setGuide] = useState({ busy: false, msg: '' });
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    // Wikipedia names shows in English; the folder is usually named in
    // whatever language the files were downloaded in, so it is only a hint.
    const importGuide = async () => {
        const api = getElectronAPI();
        if (!api?.importEpisodeGuide || guide.busy) return;
        const suggested = folder.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] || '';
        const show = window.prompt(t('guideAskShow'), suggested);
        if (!show) return;

        setGuide({ busy: true, msg: '' });
        const r = await api.importEpisodeGuide(folder, show.trim());
        setGuide({
            busy: false,
            msg: r.success
                ? `${t('guideImported')} ${r.matched}/${r.episodes} · ${r.page}`
                : r.error
        });
        // Re-run whatever is typed so the new synopses are included.
        setQuery(q => `${q} `.trimEnd());
    };

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Typing runs the search; the debounce keeps every keystroke from
    // re-reading every library file on the disk.
    useEffect(() => {
        const api = getElectronAPI();
        const phrase = query.trim();
        if (!api?.searchSubtitles || !folder || !phrase) {
            setState({ results: [], busy: false, ran: false });
            return;
        }
        let dropped = false;
        setState(s => ({ ...s, busy: true }));
        const timer = setTimeout(async () => {
            const r = await api.searchSubtitles({ folder, query: phrase, scope });
            if (dropped) return;
            setState({
                results: r.results || [],
                busy: false,
                ran: true,
                searched: r.searched,
                folders: r.folders,
                truncated: r.truncated,
                episodesDropped: r.episodesDropped,
                error: r.error
            });
        }, 220);
        return () => { dropped = true; clearTimeout(timer); };
    }, [query, scope, folder]);

    // One heading per episode keeps thirty hits from reading as a flat wall.
    const grouped = useMemo(() => {
        const byVideo = new Map();
        for (const hit of state.results) {
            if (!byVideo.has(hit.videoPath)) byVideo.set(hit.videoPath, []);
            byVideo.get(hit.videoPath).push(hit);
        }
        return [...byVideo.entries()];
    }, [state.results]);

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', top: 32, left: 0, right: 0, bottom: 0, zIndex: 330,
                background: theme.overlayBg, display: 'flex', justifyContent: 'center',
                paddingTop: '6vh'
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: 680, maxWidth: '92%', maxHeight: '82%', display: 'flex',
                    flexDirection: 'column', background: theme.dialogBg,
                    border: `1px solid ${theme.border}`, borderRadius: 12,
                    boxShadow: '0 20px 60px rgba(0,0,0,0.45)'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14 }}>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        style={{
                            flex: 1, padding: '9px 12px', borderRadius: 8, fontSize: 14,
                            background: theme.inputBg, color: theme.text,
                            border: `1px solid ${theme.borderSecondary}`
                        }}
                    />
                    <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                        {['folder', 'siblings'].map(s => (
                            <button
                                key={s}
                                onClick={() => setScope(s)}
                                title={t(`searchScope_${s}_hint`)}
                                style={{
                                    padding: '7px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                    background: scope === s ? theme.accent : 'transparent',
                                    color: scope === s ? '#fff' : theme.textSecondary
                                }}
                            >
                                {t(`searchScope_${s}`)}
                            </button>
                        ))}
                    </div>
                    <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 18, padding: '0 4px' }}>
                        {'✕'}
                    </button>
                </div>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '0 16px 8px', fontSize: 11, color: theme.textTertiary,
                    borderBottom: `1px solid ${theme.border}`, minHeight: 18
                }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                        {guide.msg ? guide.msg
                            : state.error ? state.error
                                : state.busy ? t('searching')
                                    : state.ran
                                        ? `${state.results.length}${state.truncated ? '+' : ''} · ${state.searched} ${t('searchedVideos')}`
                                        + (state.episodesDropped ? ` · ${t('searchTooCommon')}` : '')
                                        : t('searchHint')}
                    </span>
                    <button
                        onClick={importGuide}
                        disabled={guide.busy}
                        title={t('guideImportHint')}
                        style={{
                            flex: 'none', fontSize: 11, padding: '3px 8px', borderRadius: 5,
                            cursor: guide.busy ? 'default' : 'pointer',
                            background: theme.inputBg, color: theme.textSecondary,
                            opacity: guide.busy ? 0.5 : 1
                        }}
                    >
                        {guide.busy ? t('guideImporting') : t('guideImport')}
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
                    {state.ran && !state.busy && state.results.length === 0 && (
                        <div style={{ padding: '24px 10px', fontSize: 13, color: theme.textTertiary }}>
                            {t('searchNoHits')}
                        </div>
                    )}

                    {grouped.map(([videoPath, hits]) => (
                        <div key={videoPath} style={{ marginBottom: 10 }}>
                            <div style={{
                                padding: '6px 10px', fontSize: 11, fontWeight: 600,
                                color: theme.textTertiary,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                            }}>
                                {episodeOf(hits[0].name)}
                            </div>
                            {hits.map(hit => (
                                <button
                                    key={`${videoPath}-${hit.index}`}
                                    onClick={() => { onPick(hit); onClose(); }}
                                    style={{
                                        display: 'flex', gap: 10, width: '100%', textAlign: 'left',
                                        padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
                                        background: 'transparent', color: theme.textSecondary
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = theme.hoverBg; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <span style={{
                                        flex: 'none', fontSize: 11, color: theme.accent,
                                        fontVariantNumeric: 'tabular-nums', paddingTop: 1
                                    }}>
                                        {hit.kind === 'episode' ? t('guideBadge') : fmt(hit.start)}
                                    </span>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>
                                        {hit.kind === 'episode' ? (
                                            <>
                                                <span style={{ fontWeight: 600, color: theme.text }}>
                                                    <Highlighted text={hit.title} query={query.trim()} color={theme.accent} />
                                                </span>
                                                <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 3 }}>
                                                    <Highlighted text={hit.summary} query={query.trim()} color={theme.accent} />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <Highlighted text={hit.text} query={query.trim()} color={theme.accent} />
                                                {hit.zh && (
                                                    <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 2 }}>
                                                        <Highlighted text={hit.zh} query={query.trim()} color={theme.accent} />
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
