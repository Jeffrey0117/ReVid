import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { toLocalVideoUrl } from '../../utils/localVideoUrl';
import { generateVideoThumbnail, getCachedThumbnail } from '../../utils/videoThumbnails';

const getElectronAPI = () => window.electronAPI || null;

// One hidden <video> per thumbnail, so a season's worth at once would stall
// the window. Rows are tall, so only a few are ever on screen anyway.
const MAX_CONCURRENT = 2;

const nameOf = (p) => p.split(/[\\/]/).pop();
const stemOf = (p) => nameOf(p).replace(/\.[^.]+$/, '');

// Browsing by what an episode is, not by what its file is called — the
// thumbnail of a frame 40 seconds in tells you nothing about the hour.
export const ShowBrowser = ({ files, folder, currentIndex, onSelectVideo }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [guides, setGuides] = useState(null);
    const [thumbs, setThumbs] = useState({});
    const activeRef = useRef(null);
    const pendingRef = useRef(new Set());

    useEffect(() => {
        const api = getElectronAPI();
        if (!api?.libraryGuides || !folder) return;
        let dropped = false;
        api.libraryGuides(folder).then(r => {
            if (!dropped) setGuides(r.byName || {});
        });
        return () => { dropped = true; };
    }, [folder]);

    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'center' });
    }, [guides]);

    // Thumbnails arrive as they are made rather than all at the end, so the
    // list fills in instead of sitting blank.
    useEffect(() => {
        let dropped = false;
        const queue = files.filter(f => !getCachedThumbnail(toLocalVideoUrl(f)));

        const run = async () => {
            for (const file of queue) {
                if (dropped) return;
                while (pendingRef.current.size >= MAX_CONCURRENT) {
                    await new Promise(r => setTimeout(r, 120));
                    if (dropped) return;
                }
                const url = toLocalVideoUrl(file);
                pendingRef.current.add(url);
                generateVideoThumbnail(url)
                    .then(data => {
                        if (!dropped && data) setThumbs(prev => ({ ...prev, [url]: data }));
                    })
                    .catch(() => { /* a frame that will not decode is not fatal */ })
                    .finally(() => pendingRef.current.delete(url));
            }
        };
        run();
        return () => { dropped = true; };
    }, [files]);

    const rows = useMemo(() => files.map((file, i) => ({
        file,
        index: i,
        guide: guides?.[nameOf(file)] || null
    })), [files, guides]);

    const withGuide = rows.filter(r => r.guide).length;

    return (
        <div style={{ width: '100%', height: '100%', overflowY: 'auto', background: theme.bg }}>
            <div style={{
                padding: '14px 20px 10px', fontSize: 12, color: theme.textTertiary,
                display: 'flex', alignItems: 'center', gap: 8
            }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
                    {folder ? folder.split(/[\\/]/).filter(Boolean).pop() : ''}
                </span>
                <span>
                    {files.length} {t('episodesWord')}
                    {guides && withGuide < files.length && ` · ${t('showNoGuideYet')}`}
                </span>
            </div>

            {rows.map(({ file, index, guide }) => {
                const url = toLocalVideoUrl(file);
                const thumb = thumbs[url] || getCachedThumbnail(url);
                const active = index === currentIndex;
                return (
                    <button
                        key={file}
                        ref={active ? activeRef : undefined}
                        onClick={() => onSelectVideo(index)}
                        style={{
                            display: 'flex', gap: 14, width: '100%', textAlign: 'left',
                            padding: '10px 20px', cursor: 'pointer',
                            background: active ? theme.accentBg : 'transparent',
                            borderLeft: `3px solid ${active ? theme.accent : 'transparent'}`
                        }}
                        onMouseEnter={(e) => {
                            if (!active) e.currentTarget.style.background = theme.hoverBg;
                        }}
                        onMouseLeave={(e) => {
                            if (!active) e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        <span style={{
                            flex: 'none', width: 168, height: 95, borderRadius: 6,
                            overflow: 'hidden', background: theme.inputBg,
                            display: 'grid', placeItems: 'center'
                        }}>
                            {thumb
                                ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span style={{ fontSize: 11, color: theme.textTertiary }}>{index + 1}</span>}
                        </span>

                        <span style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                            <span style={{
                                display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4
                            }}>
                                <span style={{
                                    fontSize: 12, fontWeight: 700, color: theme.textTertiary,
                                    fontVariantNumeric: 'tabular-nums'
                                }}>
                                    {guide?.episode != null ? String(guide.episode).padStart(2, '0') : index + 1}
                                </span>
                                <span style={{
                                    fontSize: 14, fontWeight: 600,
                                    color: active ? theme.accent : theme.text,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                }}>
                                    {guide?.title || stemOf(file)}
                                </span>
                                {guide?.airDate && (
                                    <span style={{ flex: 'none', fontSize: 11, color: theme.textTertiary }}>
                                        {guide.airDate}
                                    </span>
                                )}
                            </span>
                            <span style={{
                                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                                overflow: 'hidden', fontSize: 12.5, lineHeight: 1.5,
                                color: theme.textSecondary
                            }}>
                                {guide?.summary || t('showNoSummary')}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
