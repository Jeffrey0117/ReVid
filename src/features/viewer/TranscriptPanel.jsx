import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';

function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Language-learning sidebar: every subtitle line with its timestamp, the line
// being spoken highlighted and kept in view, click to jump there.
export const TranscriptPanel = ({ cues, activeIndex, onSeekTo, onClose, transcribing }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const listRef = useRef(null);
    const activeRef = useRef(null);

    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [activeIndex]);

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
                    {t('transcriptTitle')}
                </span>
                <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 16, padding: '0 4px' }}>
                    {'✕'}
                </button>
            </div>

            <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
                {cues.length === 0 && (
                    <div style={{ padding: '20px 14px', fontSize: 12, color: theme.textTertiary }}>
                        {transcribing ? t('transcriptWaiting') : t('transcriptEmpty')}
                    </div>
                )}
                {cues.map((cue, i) => (
                    <div
                        key={`${cue.start}-${i}`}
                        ref={i === activeIndex ? activeRef : undefined}
                        onClick={() => onSeekTo(cue.start)}
                        style={{
                            display: 'flex', gap: 10, padding: '7px 14px', cursor: 'pointer',
                            background: i === activeIndex ? theme.accentBg : 'transparent',
                            borderLeft: i === activeIndex
                                ? `3px solid ${theme.accent}`
                                : '3px solid transparent'
                        }}
                    >
                        <span style={{
                            fontSize: 11, color: theme.accent, flexShrink: 0,
                            fontVariantNumeric: 'tabular-nums', paddingTop: 2
                        }}>
                            {fmt(cue.start)}
                        </span>
                        <span style={{ minWidth: 0 }}>
                            <span style={{
                                display: 'block',
                                fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                                color: i === activeIndex ? theme.text : theme.textSecondary
                            }}>
                                {cue.text}
                            </span>
                            {cue.zh && (
                                <span style={{
                                    display: 'block', marginTop: 2,
                                    fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                                    color: theme.textTertiary
                                }}>
                                    {cue.zh}
                                </span>
                            )}
                        </span>
                    </div>
                ))}
                {transcribing && cues.length > 0 && (
                    <div style={{ padding: '10px 14px', fontSize: 12, color: theme.textTertiary }}>
                        {t('transcriptWaiting')}
                    </div>
                )}
            </div>
        </div>
    );
};
