import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { Repeat, Pencil } from '../../components/icons';
import { ClickableText } from './WordLookup';

function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Language-learning sidebar: every subtitle line with its timestamp, the line
// being spoken highlighted and kept in view, click to jump there, and a
// per-line repeat for drilling one sentence.
export const TranscriptPanel = ({
    cues, activeIndex, onSeekTo, onClose, transcribing, loopCueIndex, onLoopCue,
    difficultMarks, onWordClick, onEditCue, onCutSelection
}) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const listRef = useRef(null);
    const activeRef = useRef(null);
    const [editing, setEditing] = useState(-1);
    const [draft, setDraft] = useState('');
    // Picking lines to cut: the transcript doubles as the edit decision list.
    const [picking, setPicking] = useState(false);
    const [picked, setPicked] = useState(() => new Set());
    const lastPickRef = useRef(-1);

    const togglePick = (i, shiftKey) => {
        setPicked(prev => {
            const next = new Set(prev);
            const turningOn = !next.has(i);
            if (shiftKey && lastPickRef.current >= 0) {
                const lo = Math.min(lastPickRef.current, i);
                const hi = Math.max(lastPickRef.current, i);
                for (let k = lo; k <= hi; k++) {
                    if (turningOn) next.add(k); else next.delete(k);
                }
            } else if (turningOn) {
                next.add(i);
            } else {
                next.delete(i);
            }
            return next;
        });
        lastPickRef.current = i;
    };

    useEffect(() => {
        // Following the playhead while typing would yank the field away.
        if (editing >= 0) return;
        activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [activeIndex, editing]);

    const beginEdit = (i, text) => {
        setEditing(i);
        setDraft(text);
    };

    const commit = () => {
        if (editing >= 0 && draft.trim() && draft !== cues[editing]?.text) {
            onEditCue?.(editing, draft.trim());
        }
        setEditing(-1);
    };

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
                <div style={{ flex: 1 }} />
                {onCutSelection && cues.length > 0 && (
                    <button
                        title={t('transcriptCutHint')}
                        onClick={() => { setPicking(p => !p); setPicked(new Set()); }}
                        style={{
                            fontSize: 11, padding: '3px 8px', borderRadius: 4, marginRight: 6,
                            background: picking ? theme.accent : theme.inputBg,
                            color: picking ? '#fff' : theme.textSecondary
                        }}
                    >
                        {t('transcriptCut')}
                    </button>
                )}
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
                        onClick={(e) => (picking ? togglePick(i, e.shiftKey) : onSeekTo(cue.start))}
                        style={{
                            display: 'flex', gap: 10, padding: '7px 14px', cursor: 'pointer',
                            position: 'relative',
                            background: picked.has(i)
                                ? theme.accentBg
                                : (i === loopCueIndex || i === activeIndex ? theme.accentBg : 'transparent'),
                            outline: picked.has(i) ? `1px solid ${theme.accent}` : 'none',
                            borderLeft: i === loopCueIndex
                                ? `3px solid ${theme.pin}`
                                : (i === activeIndex ? `3px solid ${theme.accent}` : '3px solid transparent')
                        }}
                    >
                        <span style={{
                            fontSize: 11, color: theme.accent, flexShrink: 0,
                            fontVariantNumeric: 'tabular-nums', paddingTop: 2
                        }}>
                            {fmt(cue.start)}
                        </span>
                        <span style={{ minWidth: 0 }}>
                            {editing === i ? (
                                <textarea
                                    autoFocus
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={commit}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
                                        if (e.key === 'Escape') setEditing(-1);
                                    }}
                                    rows={Math.max(2, Math.ceil(draft.length / 34))}
                                    style={{
                                        display: 'block', width: '100%', resize: 'vertical',
                                        fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit',
                                        padding: '4px 6px', borderRadius: 4,
                                        background: theme.inputBg, color: theme.text,
                                        border: `1px solid ${theme.accent}`
                                    }}
                                />
                            ) : (
                                <ClickableText
                                    text={cue.text}
                                    marks={difficultMarks?.[i]}
                                    markColor={theme.pin}
                                    onWordClick={(w, e) => onWordClick?.(w, e, cue.text)}
                                    style={{
                                        display: 'block',
                                        fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                                        color: i === activeIndex ? theme.text : theme.textSecondary
                                    }}
                                />
                            )}
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

                        {/* Whisper mishears names and jargon, and a wrong line
                            poisons the translation, the word list and every
                            export built from it. */}
                        {onEditCue && editing !== i && (
                            <button
                                title={t('transcriptEdit')}
                                onClick={(e) => { e.stopPropagation(); beginEdit(i, cue.text); }}
                                style={{
                                    flexShrink: 0, alignSelf: 'flex-start',
                                    width: 22, height: 22, borderRadius: 4,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'transparent', color: theme.textTertiary, opacity: 0.65
                                }}
                            >
                                <Pencil size={12} />
                            </button>
                        )}

                        {/* Drill one sentence: repeat it until switched off. */}
                        <button
                            title={t('transcriptRepeat')}
                            onClick={(e) => { e.stopPropagation(); onLoopCue(i === loopCueIndex ? -1 : i); }}
                            style={{
                                flexShrink: 0, alignSelf: 'flex-start',
                                width: 22, height: 22, borderRadius: 4,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: i === loopCueIndex ? theme.pin : 'transparent',
                                color: i === loopCueIndex ? '#fff' : theme.textTertiary,
                                opacity: i === loopCueIndex ? 1 : 0.65
                            }}
                        >
                            <Repeat size={13} />
                        </button>
                    </div>
                ))}
                {transcribing && cues.length > 0 && (
                    <div style={{ padding: '10px 14px', fontSize: 12, color: theme.textTertiary }}>
                        {t('transcriptWaiting')}
                    </div>
                )}
            </div>

            {picking && (
                <div style={{ padding: '10px 14px', borderTop: `1px solid ${theme.border}` }}>
                    <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 6 }}>
                        {t('transcriptCutPick')}
                    </div>
                    <button
                        className="btn btn-primary"
                        disabled={picked.size === 0}
                        onClick={() => {
                            // Adjacent lines become one clip, so picking a run
                            // of dialogue does not produce ten tiny files.
                            const sorted = [...picked].sort((a, b) => a - b);
                            const ranges = [];
                            for (const i of sorted) {
                                const last = ranges[ranges.length - 1];
                                if (last && last.endIndex === i - 1) {
                                    last.endIndex = i;
                                    last.end = cues[i].end;
                                } else {
                                    ranges.push({
                                        startIndex: i, endIndex: i,
                                        start: cues[i].start, end: cues[i].end
                                    });
                                }
                            }
                            onCutSelection(ranges);
                            setPicking(false);
                            setPicked(new Set());
                        }}
                        style={{ width: '100%' }}
                    >
                        {t('transcriptCutGo')} ({picked.size})
                    </button>
                </div>
            )}
        </div>
    );
};
