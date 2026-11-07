import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { toLocalVideoUrl } from '../../utils/localVideoUrl';
import { generateVideoThumbnail, getCachedThumbnail } from '../../utils/videoThumbnails';
import { getVideoMetadata, getCachedMetadata } from '../../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

// Each thumbnail spins up a hidden <video>; a season at once would stall the
// window, and only a few cards are on screen anyway.
const MAX_CONCURRENT = 2;

const stemOf = (name) => name.replace(/\.[^.]+$/, '');
const mins = (sec) => (sec > 0 ? `${Math.round(sec / 60)}` : null);

// Browsing a show the way a streaming app does: what it is, which season,
// and what each episode is about — rather than a wall of frames grabbed
// forty seconds in, which say nothing about the hour.
export const ShowBrowser = ({ folder, onOpenEpisode }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [data, setData] = useState(null);
    const [seasonIdx, setSeasonIdx] = useState(0);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [media, setMedia] = useState({});
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const pendingRef = useRef(new Set());
    const stripRef = useRef(null);

    const load = async () => {
        const api = getElectronAPI();
        if (!api?.showSeasons || !folder) return;
        const r = await api.showSeasons(folder);
        setData(r);
        setSeasonIdx(0);
    };

    useEffect(() => { load(); }, [folder]);

    const season = data?.seasons?.[seasonIdx] || null;
    const show = data?.show || null;

    // Thumbnails and durations fill in as they are made, so the strip is
    // usable immediately instead of blank until the last one lands.
    useEffect(() => {
        if (!season) return;
        let dropped = false;

        const run = async () => {
            for (const ep of season.episodes) {
                if (dropped) return;
                const url = toLocalVideoUrl(ep.videoPath);
                if (getCachedThumbnail(url) && getCachedMetadata(url)) continue;
                while (pendingRef.current.size >= MAX_CONCURRENT) {
                    await new Promise(r => setTimeout(r, 120));
                    if (dropped) return;
                }
                pendingRef.current.add(url);
                Promise.all([
                    generateVideoThumbnail(url).catch(() => null),
                    getVideoMetadata(url).catch(() => null)
                ])
                    .then(([thumb, meta]) => {
                        if (dropped) return;
                        setMedia(prev => ({
                            ...prev,
                            [url]: { thumb: thumb || prev[url]?.thumb, meta: meta || prev[url]?.meta }
                        }));
                    })
                    .finally(() => pendingRef.current.delete(url));
            }
        };
        run();
        return () => { dropped = true; };
    }, [season]);

    useEffect(() => {
        if (stripRef.current) stripRef.current.scrollLeft = 0;
    }, [seasonIdx]);

    // Chinese Wikipedia carries its own synopses, not translated titles, so
    // the language is a choice about where to read from rather than a filter.
    const importShow = async (lang) => {
        const api = getElectronAPI();
        if (!api?.importShow || busy) return;
        const folderName = (folder || '').split(/[\\/]/).filter(Boolean).pop() || '';
        // The folder is usually named in the language it was downloaded in,
        // which is the better guess for zh and the worse one for en.
        const suggested = lang === 'zh'
            ? (show?.lang === 'zh' ? show.page : folderName)
            : (show?.lang === 'en' ? show.page : folderName);
        const name = window.prompt(t(lang === 'zh' ? 'guideAskShowZh' : 'guideAskShow'), suggested);
        if (!name) return;

        setBusy(true);
        setMsg('');
        const r = await api.importShow(folder, name.trim(), lang);
        setBusy(false);
        setMsg(r.success
            ? `${t('guideImported')} ${r.guided} · ${r.seasons} ${t('seasonsWord')}`
              + (r.failures?.length ? ` · ${r.failures.length} ${t('showSeasonFailed')}` : '')
            : r.error);
        if (r.success) load();
    };

    const facts = useMemo(() => {
        if (!show) return [];
        return [
            show.year,
            data?.seasons?.length ? `${t('showSeasonsCount')} ${data.seasons.length}` : null,
            show.genre?.slice(0, 2).join(' · ')
        ].filter(Boolean);
    }, [show, data, t]);

    if (!data) return null;

    if (!season) {
        return (
            <div style={{ padding: 40, color: theme.textTertiary, fontSize: 13 }}>
                {t('showNothingHere')}
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: '100%', overflowY: 'auto', background: theme.bg }}>
            {/* Show header. The artwork sits behind it, dimmed enough that
                the text over it stays readable on any poster. */}
            <div style={{
                position: 'relative', margin: 16, padding: '20px 24px',
                borderRadius: 10, overflow: 'hidden',
                background: theme.bgSecondary, border: `1px solid ${theme.border}`
            }}>
                {show?.poster && (
                    <>
                        <div style={{
                            position: 'absolute', inset: 0,
                            backgroundImage: `url(${show.poster})`,
                            backgroundSize: 'cover', backgroundPosition: 'center',
                            opacity: 0.22, filter: 'blur(1px)'
                        }} />
                        <div style={{
                            position: 'absolute', inset: 0,
                            background: `linear-gradient(90deg, ${theme.bgSecondary} 30%, transparent)`
                        }} />
                    </>
                )}

                <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 24, fontWeight: 700, color: theme.text }}>
                        {(folder || '').split(/[\\/]/).filter(Boolean).pop()}
                    </span>
                    <div style={{
                        display: 'flex', borderRadius: 5, overflow: 'hidden',
                        border: `1px solid ${theme.border}`
                    }}>
                        {[['zh', '中文'], ['en', 'EN']].map(([code, label]) => (
                            <button
                                key={code}
                                onClick={() => importShow(code)}
                                disabled={busy}
                                title={t('showLangHint')}
                                style={{
                                    fontSize: 11, padding: '3px 9px',
                                    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                                    background: show?.lang === code ? theme.accent : theme.inputBg,
                                    color: show?.lang === code ? '#fff' : theme.textSecondary
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {busy && (
                        <span style={{ fontSize: 11, color: theme.textTertiary }}>
                            {t('guideImporting')}
                        </span>
                    )}
                </div>

                {facts.length > 0 && (
                    <div style={{ position: 'relative', marginTop: 6, fontSize: 12, color: theme.textTertiary }}>
                        {facts.join('  ·  ')}
                    </div>
                )}

                {msg && (
                    <div style={{ position: 'relative', marginTop: 8, fontSize: 12, color: theme.accent }}>{msg}</div>
                )}

                {show?.description && (
                    <div style={{
                        position: 'relative',
                        display: 'flex', gap: 32, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-start'
                    }}>
                        <p style={{
                            flex: '1 1 380px', margin: 0, maxWidth: 620,
                            fontSize: 13, lineHeight: 1.65, color: theme.textSecondary
                        }}>
                            {show.description}
                        </p>
                        <div style={{ flex: '0 1 300px', fontSize: 12, lineHeight: 1.8 }}>
                            {show.starring?.length > 0 && (
                                <div style={{ color: theme.textTertiary }}>
                                    {t('showStarring')}
                                    <span style={{ color: theme.textSecondary, marginLeft: 6 }}>
                                        {show.starring.slice(0, 6).join('、')}
                                    </span>
                                </div>
                            )}
                            {show.creators?.length > 0 && (
                                <div style={{ color: theme.textTertiary }}>
                                    {t('showCreators')}
                                    <span style={{ color: theme.textSecondary, marginLeft: 6 }}>
                                        {show.creators.join('、')}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Season picker */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '6px 24px 12px'
            }}>
                <span style={{ fontSize: 19, fontWeight: 700, color: theme.text }}>
                    {t('showEpisodes')}
                </span>
                {data.seasons.length > 1 && (
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); setPickerOpen(o => !o); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                                fontSize: 13, background: theme.inputBg, color: theme.text,
                                border: `1px solid ${theme.border}`
                            }}
                        >
                            {season.name}
                            <span style={{ fontSize: 10, color: theme.textTertiary }}>{'▼'}</span>
                        </button>
                        {pickerOpen && (
                            <>
                                <div
                                    onClick={() => setPickerOpen(false)}
                                    style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                                />
                                <div style={{
                                    position: 'absolute', top: 34, left: 0, zIndex: 11,
                                    minWidth: 150, maxHeight: '50vh', overflowY: 'auto', padding: 4,
                                    background: theme.dialogBg, borderRadius: 8,
                                    border: `1px solid ${theme.border}`,
                                    boxShadow: '0 12px 36px rgba(0,0,0,0.45)'
                                }}>
                                    {data.seasons.map((s, i) => (
                                        <button
                                            key={s.folder}
                                            onClick={() => { setSeasonIdx(i); setPickerOpen(false); }}
                                            style={{
                                                display: 'flex', justifyContent: 'space-between', gap: 12,
                                                width: '100%', padding: '7px 10px', borderRadius: 5,
                                                textAlign: 'left', cursor: 'pointer', fontSize: 13,
                                                background: i === seasonIdx ? theme.accentBg : 'transparent',
                                                color: i === seasonIdx ? theme.accent : theme.textSecondary
                                            }}
                                        >
                                            {s.name}
                                            <span style={{ fontSize: 11, color: theme.textTertiary }}>
                                                {s.episodes.length}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Episode cards */}
            <div
                ref={stripRef}
                style={{
                    display: 'grid', gap: 16, padding: '0 24px 28px',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))'
                }}
            >
                {season.episodes.map((ep, i) => {
                    const url = toLocalVideoUrl(ep.videoPath);
                    const thumb = media[url]?.thumb || getCachedThumbnail(url);
                    const meta = media[url]?.meta || getCachedMetadata(url);
                    const length = mins(meta?.duration);
                    const num = ep.guide?.episode ?? i + 1;
                    return (
                        <button
                            key={ep.videoPath}
                            onClick={() => onOpenEpisode(ep.videoPath)}
                            style={{
                                display: 'flex', flexDirection: 'column', textAlign: 'left',
                                borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                                background: theme.bgSecondary,
                                border: `1px solid ${theme.border}`
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.accent; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; }}
                        >
                            <span style={{
                                position: 'relative', display: 'block', width: '100%',
                                aspectRatio: '16 / 9', background: theme.inputBg
                            }}>
                                {thumb && (
                                    <img
                                        src={thumb}
                                        alt=""
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                )}
                                {length && (
                                    <span style={{
                                        position: 'absolute', right: 6, bottom: 6,
                                        padding: '1px 6px', borderRadius: 3, fontSize: 11,
                                        background: 'rgba(0,0,0,0.75)', color: '#fff'
                                    }}>
                                        {length} {t('minutesShort')}
                                    </span>
                                )}
                                {ep.hasSubs && (
                                    <span style={{
                                        position: 'absolute', left: 6, bottom: 6,
                                        padding: '1px 5px', borderRadius: 3, fontSize: 10,
                                        background: 'rgba(0,0,0,0.75)', color: '#fff'
                                    }}>
                                        {t('subMenuTitle')}
                                    </span>
                                )}
                            </span>

                            <span style={{ padding: '10px 12px 13px' }}>
                                <span style={{
                                    display: 'block', fontSize: 13.5, fontWeight: 600,
                                    color: theme.text, marginBottom: 5,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                }}>
                                    {`${t('episodeN').replace('{n}', num)}  ${ep.guide?.title || stemOf(ep.name)}`}
                                </span>
                                <span style={{
                                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden', fontSize: 12, lineHeight: 1.55,
                                    color: theme.textTertiary
                                }}>
                                    {ep.guide?.summary || t('showNoSummary')}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
