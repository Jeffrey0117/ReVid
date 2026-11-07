import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { toLocalVideoUrl } from '../../utils/localVideoUrl';
import { getCachedThumbnail } from '../../utils/videoThumbnails';
import { getCachedMetadata } from '../../utils/videoMetadata';

const stemOf = (name) => name.replace(/\.[^.]+$/, '');
const mins = (sec) => (sec > 0 ? Math.round(sec / 60) : null);

// Reading before committing: the card said three lines, this says the rest,
// and the rest of the season is right there so changing your mind costs one
// click instead of a trip back to the grid.
export const EpisodeSheet = ({ episode, season, onPlay, onPick, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const activeRef = useRef(null);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter') onPlay(episode.videoPath);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, onPlay, episode]);

    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'nearest' });
    }, [episode]);

    const url = toLocalVideoUrl(episode.videoPath);
    const thumb = getCachedThumbnail(url);
    const length = mins(getCachedMetadata(url)?.duration);
    const num = episode.guide?.episode;

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 340,
                background: theme.overlayBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: 760, maxWidth: '100%', maxHeight: '88%',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    background: theme.dialogBg, color: theme.text,
                    border: `1px solid ${theme.border}`, borderRadius: 12,
                    boxShadow: '0 24px 70px rgba(0,0,0,0.5)'
                }}
            >
                <div style={{
                    position: 'relative', width: '100%', aspectRatio: '16 / 7',
                    background: theme.inputBg, flexShrink: 0
                }}>
                    {thumb && (
                        <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: `linear-gradient(to top, ${theme.dialogBg} 4%, transparent 70%)`
                    }} />
                    <button
                        onClick={onClose}
                        style={{
                            position: 'absolute', top: 10, right: 12, fontSize: 18,
                            color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)', cursor: 'pointer'
                        }}
                    >
                        {'✕'}
                    </button>
                    <button
                        onClick={() => onPlay(episode.videoPath)}
                        style={{
                            position: 'absolute', left: 24, bottom: 18,
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '9px 22px', borderRadius: 7, cursor: 'pointer',
                            fontSize: 14, fontWeight: 700,
                            background: '#fff', color: '#111'
                        }}
                    >
                        {'▶'} {t('showPlay')}
                    </button>
                </div>

                <div style={{ padding: '4px 24px 14px', flexShrink: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
                        {num != null ? `${t('episodeN').replace('{n}', num)}  ` : ''}
                        {episode.guide?.title || stemOf(episode.name)}
                    </div>
                    <div style={{ fontSize: 11.5, color: theme.textTertiary, marginBottom: 9 }}>
                        {[
                            episode.guide?.airDate,
                            length ? `${length} ${t('minutesShort')}` : null,
                            episode.hasSubs ? t('subMenuTitle') : null
                        ].filter(Boolean).join('  ·  ')}
                    </div>
                    <p style={{
                        margin: 0, fontSize: 13.5, lineHeight: 1.7, color: theme.textSecondary
                    }}>
                        {episode.guide?.summary || t('showNoSummary')}
                    </p>
                </div>

                {season?.episodes?.length > 1 && (
                    <>
                        <div style={{
                            padding: '10px 24px 6px', fontSize: 12, fontWeight: 600,
                            color: theme.textTertiary, borderTop: `1px solid ${theme.border}`
                        }}>
                            {season.name} · {season.episodes.length} {t('episodesWord')}
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
                            {season.episodes.map((ep, i) => {
                                const active = ep.videoPath === episode.videoPath;
                                return (
                                    <button
                                        key={ep.videoPath}
                                        ref={active ? activeRef : undefined}
                                        onClick={() => onPick(ep)}
                                        style={{
                                            display: 'flex', alignItems: 'baseline', gap: 10, width: '100%',
                                            padding: '7px 8px', borderRadius: 6, textAlign: 'left',
                                            cursor: 'pointer', fontSize: 13,
                                            background: active ? theme.accentBg : 'transparent',
                                            color: active ? theme.accent : theme.textSecondary
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!active) e.currentTarget.style.background = theme.hoverBg;
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!active) e.currentTarget.style.background = 'transparent';
                                        }}
                                    >
                                        <span style={{
                                            flex: 'none', minWidth: 20, fontSize: 11,
                                            fontVariantNumeric: 'tabular-nums',
                                            color: active ? theme.accent : theme.textTertiary
                                        }}>
                                            {ep.guide?.episode ?? i + 1}
                                        </span>
                                        <span style={{
                                            flex: 1, minWidth: 0,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                        }}>
                                            {ep.guide?.title || stemOf(ep.name)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
