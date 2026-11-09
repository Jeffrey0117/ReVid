import { useState } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';

export const SUBTITLE_STYLE_KEY = 'revid-subtitle-style';

const TRANSLATE_ENGINE_KEY = 'revid-translate-engine';
const GEMINI_KEY = 'revid-gemini-key';
const AUTO_TRANSLATE_KEY = 'revid-auto-translate';

function readTranslateSettings() {
    return {
        engine: localStorage.getItem(TRANSLATE_ENGINE_KEY) || 'google',
        apiKey: localStorage.getItem(GEMINI_KEY) || '',
        auto: localStorage.getItem(AUTO_TRANSLATE_KEY) !== 'off'
    };
}

export const DEFAULT_SUBTITLE_STYLE = {
    fontSize: 18,
    color: '#ffffff',
    bgOpacity: 0.72,
    position: 'bottom', // bottom | top
    offset: 76,         // px from that edge
    widthPct: 82,       // % of the video area the box may fill
    timeShift: 0,       // seconds added to every cue time
    strokeWidth: 0,     // px; 0 = no outline
    strokeColor: '#000000',
    shadow: 0.6         // 0..1 drop-shadow strength
};

// Ready-made looks. Values follow the presets in the user's subtitle
// projects, where they were tuned against real footage.
export const SUBTITLE_PRESETS = [
    { id: 'plain', name: 'Clean', style: { bgOpacity: 0.72, strokeWidth: 0, shadow: 0.6, color: '#ffffff' } },
    { id: 'outline', name: 'Outlined', style: { bgOpacity: 0, strokeWidth: 3, strokeColor: '#000000', shadow: 0.5, color: '#ffffff' } },
    { id: 'bold', name: 'Bold yellow', style: { bgOpacity: 0, strokeWidth: 4, strokeColor: '#000000', shadow: 0.55, color: '#ffe082' } },
    { id: 'netflix', name: 'Soft shadow', style: { bgOpacity: 0, strokeWidth: 0, shadow: 0.9, color: '#ffffff' } }
];

// An outline needs the stroke painted BEHIND the fill, otherwise the glyph
// eats its inner half and the border looks half as thick as requested.
export function subtitleTextStyle(style) {
    const css = { color: style.color };
    if (style.strokeWidth > 0) {
        css.WebkitTextStroke = `${style.strokeWidth}px ${style.strokeColor}`;
        css.paintOrder = 'stroke fill';
    }
    if (style.shadow > 0) {
        const a = style.shadow;
        css.textShadow = `0 2px 4px rgba(0,0,0,${a}), 0 0 2px rgba(0,0,0,${a * 0.8})`;
    }
    return css;
}

export function writeSubtitleStyle(style) {
    try {
        localStorage.setItem(SUBTITLE_STYLE_KEY, JSON.stringify(style));
    } catch (e) {
        // Storage disabled or full: the look still applies for this session.
    }
}

export function readSubtitleStyle() {
    try {
        const saved = JSON.parse(localStorage.getItem(SUBTITLE_STYLE_KEY));
        return saved ? { ...DEFAULT_SUBTITLE_STYLE, ...saved } : { ...DEFAULT_SUBTITLE_STYLE };
    } catch {
        return { ...DEFAULT_SUBTITLE_STYLE };
    }
}

const COLORS = ['#ffffff', '#ffe082', '#aed581', '#81d4fa', '#f48fb1'];
const SIZES = [14, 18, 24, 30, 38];

function Row({ label, children }) {
    const { theme } = useTheme();
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 5 }}>{label}</div>
            {children}
        </div>
    );
}

const CC_CHOICES = ['off', 'orig', 'zh', 'both'];

// Two pages, because everything on one was a scroll the length of the window.
// The front page is what gets changed mid-episode; the rest lives one tap in.
export const SubtitleSettings = ({
    ccMode, onCcMode,
    style, onChange, onClose, onRetranscribe, onExportSrt,
    difficulty, onDifficultyChange, knownCount = 0, onForgetKnown
}) => {
    const { t } = useI18n();
    const { theme } = useTheme();

    const [page, setPage] = useState('main');
    const [translate, setTranslateState] = useState(readTranslateSettings);

    // Storing happens where the state lives, not here. This panel used to be
    // the only thing that could change the style, so it wrote the key itself;
    // now that the subtitle can also be dragged, a writer per caller means
    // whichever one is forgotten silently loses the setting on reload.
    const set = (patch) => onChange({ ...style, ...patch });

    const setTranslate = (patch) => {
        const next = { ...translate, ...patch };
        localStorage.setItem(TRANSLATE_ENGINE_KEY, next.engine);
        localStorage.setItem(GEMINI_KEY, next.apiKey);
        localStorage.setItem(AUTO_TRANSLATE_KEY, next.auto ? 'on' : 'off');
        setTranslateState(next);
    };

    const shell = (children) => (
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                width: 250, padding: 14, maxHeight: '70vh', overflowY: 'auto',
                background: theme.dialogBg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 10,
                boxShadow: '0 10px 32px rgba(0,0,0,0.4)'
            }}
        >
            {children}
        </div>
    );

    if (page === 'main') {
        return shell(
            <>
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10
                }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t('subMenuTitle')}</span>
                    <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 15 }}>{'✕'}</button>
                </div>

                {CC_CHOICES.map((mode) => (
                    <button
                        key={mode}
                        onClick={() => onCcMode?.(mode)}
                        style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '7px 8px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                            background: ccMode === mode ? theme.accentBg : 'transparent',
                            color: ccMode === mode ? theme.accent : theme.textSecondary,
                            fontWeight: ccMode === mode ? 600 : 400
                        }}
                    >
                        {t(`cc_${mode}`)}
                    </button>
                ))}

                <div style={{ height: 1, background: theme.border, margin: '10px 0' }} />

                <label style={{
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    padding: '7px 8px', fontSize: 13, color: theme.textSecondary
                }}>
                    <input
                        type="checkbox"
                        checked={translate.auto}
                        onChange={(e) => setTranslate({ auto: e.target.checked })}
                        style={{ accentColor: theme.accent }}
                    />
                    {t('translateAuto')}
                </label>

                <button
                    onClick={() => setPage('settings')}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
                        fontSize: 13, color: theme.textSecondary
                    }}
                >
                    {t('subStyleTitle')}
                    <span style={{ color: theme.textTertiary }}>{'›'}</span>
                </button>
            </>
        );
    }

    return shell(
        <>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 12
            }}>
                <button
                    onClick={() => setPage('main')}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                        fontSize: 13, fontWeight: 600, color: theme.text
                    }}
                >
                    <span style={{ color: theme.textTertiary }}>{'‹'}</span>
                    {t('subStyleTitle')}
                </button>
                <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 15 }}>{'✕'}</button>
            </div>

            <Row label={t('subStylePreset')}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {SUBTITLE_PRESETS.map(p => (
                        <button
                            key={p.id}
                            onClick={() => set(p.style)}
                            style={{
                                flex: '1 0 46%', padding: '5px 0', borderRadius: 5, fontSize: 11,
                                background: theme.inputBg, color: theme.textSecondary
                            }}
                        >
                            {t(`subPreset_${p.id}`)}
                        </button>
                    ))}
                </div>
            </Row>

            <Row label={t('subStyleSize')}>
                <div style={{ display: 'flex', gap: 4 }}>
                    {SIZES.map((s, i) => (
                        <button
                            key={s}
                            onClick={() => set({ fontSize: s })}
                            style={{
                                flex: 1, padding: '5px 0', borderRadius: 5,
                                fontSize: 10 + i * 2, lineHeight: 1,
                                background: style.fontSize === s ? theme.accent : theme.inputBg,
                                color: style.fontSize === s ? '#fff' : theme.textSecondary
                            }}
                        >
                            A
                        </button>
                    ))}
                </div>
            </Row>

            <Row label={t('subStyleColor')}>
                <div style={{ display: 'flex', gap: 6 }}>
                    {COLORS.map((c) => (
                        <button
                            key={c}
                            onClick={() => set({ color: c })}
                            style={{
                                width: 28, height: 24, borderRadius: 5, background: c,
                                border: style.color === c
                                    ? `2px solid ${theme.accent}`
                                    : `1px solid ${theme.borderSecondary}`
                            }}
                        />
                    ))}
                </div>
            </Row>

            <Row label={`${t('subStyleBg')} ${Math.round(style.bgOpacity * 100)}%`}>
                <input
                    type="range" min="0" max="100" step="5"
                    value={Math.round(style.bgOpacity * 100)}
                    onChange={(e) => set({ bgOpacity: Number(e.target.value) / 100 })}
                    style={{ width: '100%', accentColor: theme.accent }}
                />
            </Row>

            <Row label={`${t('subStyleStroke')} ${style.strokeWidth}px`}>
                <input
                    type="range" min="0" max="8" step="0.5"
                    value={style.strokeWidth}
                    onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: theme.accent }}
                />
                {style.strokeWidth > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        {['#000000', '#1a237e', '#4a148c', '#b71c1c', '#ffffff'].map(c => (
                            <button
                                key={c}
                                onClick={() => set({ strokeColor: c })}
                                style={{
                                    width: 26, height: 20, borderRadius: 4, background: c,
                                    border: style.strokeColor === c
                                        ? `2px solid ${theme.accent}`
                                        : `1px solid ${theme.borderSecondary}`
                                }}
                            />
                        ))}
                    </div>
                )}
            </Row>

            <Row label={`${t('subStyleShadow')} ${Math.round(style.shadow * 100)}%`}>
                <input
                    type="range" min="0" max="100" step="5"
                    value={Math.round(style.shadow * 100)}
                    onChange={(e) => set({ shadow: Number(e.target.value) / 100 })}
                    style={{ width: '100%', accentColor: theme.accent }}
                />
            </Row>

            <Row label={`${t('subStyleWidth')} ${style.widthPct}%`}>
                <input
                    type="range" min="20" max="100" step="2"
                    value={style.widthPct}
                    onChange={(e) => set({ widthPct: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: theme.accent }}
                />
            </Row>

            <Row label={t('subStylePosition')}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    {['bottom', 'top'].map((p) => (
                        <button
                            key={p}
                            onClick={() => set({ position: p })}
                            style={{
                                flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 12,
                                background: style.position === p ? theme.accent : theme.inputBg,
                                color: style.position === p ? '#fff' : theme.textSecondary
                            }}
                        >
                            {p === 'bottom' ? t('subStyleBottom') : t('subStyleTop')}
                        </button>
                    ))}
                </div>
                {/* From 0, because dragging can park the box flush against the
                    edge and the slider must be able to show that rather than
                    snapping it back inside an arbitrary margin. */}
                <input
                    type="range" min="0" max="400" step="2"
                    value={style.offset}
                    onChange={(e) => set({ offset: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: theme.accent }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: theme.textTertiary, flex: 1 }}>
                        {t('subDragHint')}
                    </span>
                    <button
                        onClick={() => set({
                            position: DEFAULT_SUBTITLE_STYLE.position,
                            offset: DEFAULT_SUBTITLE_STYLE.offset
                        })}
                        style={{
                            padding: '4px 8px', borderRadius: 5, fontSize: 11,
                            background: theme.inputBg, color: theme.textSecondary
                        }}
                    >
                        {t('subPositionReset')}
                    </button>
                </div>
            </Row>

            <button
                onClick={() => set({ ...DEFAULT_SUBTITLE_STYLE })}
                style={{
                    width: '100%', padding: '6px 0', borderRadius: 6, fontSize: 12,
                    background: theme.inputBg, color: theme.textSecondary
                }}
            >
                {t('subStyleReset')}
            </button>

            <div style={{ height: 1, background: theme.border, margin: '14px 0 12px' }} />

            {/* Sync nudge: recordings carry all sorts of timeline offsets, and
                no amount of fixing at the source covers every file. */}
            <Row label={`${t('subStyleSync')} ${style.timeShift > 0 ? '+' : ''}${style.timeShift.toFixed(1)}s`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                        onClick={() => set({ timeShift: Math.round((style.timeShift - 0.1) * 10) / 10 })}
                        style={{
                            width: 26, height: 22, borderRadius: 4, fontSize: 12,
                            background: theme.inputBg, color: theme.textSecondary
                        }}
                    >
                        {'−'}
                    </button>
                    <input
                        type="range" min="-10" max="10" step="0.1"
                        value={style.timeShift}
                        onChange={(e) => set({ timeShift: Number(e.target.value) })}
                        style={{ flex: 1, accentColor: theme.accent }}
                    />
                    <button
                        onClick={() => set({ timeShift: Math.round((style.timeShift + 0.1) * 10) / 10 })}
                        style={{
                            width: 26, height: 22, borderRadius: 4, fontSize: 12,
                            background: theme.inputBg, color: theme.textSecondary
                        }}
                    >
                        {'+'}
                    </button>
                </div>
                <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 4 }}>
                    {t('subStyleSyncHint')}
                </div>
            </Row>

            <div style={{ height: 1, background: theme.border, margin: '12px 0' }} />

            <Row label={t('translateEngine')}>
                <div style={{ display: 'flex', gap: 4 }}>
                    {[['google', 'Google'], ['gemini', 'Gemini']].map(([id, label]) => (
                        <button
                            key={id}
                            onClick={() => setTranslate({ engine: id })}
                            style={{
                                flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 12,
                                background: translate.engine === id ? theme.accent : theme.inputBg,
                                color: translate.engine === id ? '#fff' : theme.textSecondary
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </Row>

            {translate.engine === 'gemini' && (
                <Row label={t('translateApiKey')}>
                    <input
                        type="password"
                        value={translate.apiKey}
                        placeholder="AIza..."
                        onChange={(e) => setTranslate({ apiKey: e.target.value })}
                        style={{
                            width: '100%', padding: '5px 8px', borderRadius: 5, fontSize: 12,
                            background: theme.inputBg, color: theme.text,
                            border: `1px solid ${theme.borderSecondary}`
                        }}
                    />
                </Row>
            )}

            {onDifficultyChange && (
                <>
                    <div style={{ height: 1, background: theme.border, margin: '12px 0' }} />
                    <Row label={`${t('learnLevel')} ${difficulty.minFreqRank}`}>
                        <input
                            type="range" min="2000" max="20000" step="1000"
                            value={difficulty.minFreqRank}
                            onChange={(e) => onDifficultyChange({
                                ...difficulty, minFreqRank: Number(e.target.value)
                            })}
                            style={{ width: '100%', accentColor: theme.accent }}
                        />
                        <div style={{
                            display: 'flex', justifyContent: 'space-between',
                            fontSize: 10, color: theme.textTertiary, marginTop: 2
                        }}>
                            <span>{t('learnLevelMore')}</span>
                            <span>{t('learnLevelLess')}</span>
                        </div>
                    </Row>
                    {knownCount > 0 && (
                        <button
                            onClick={onForgetKnown}
                            style={{
                                width: '100%', padding: '6px 0', borderRadius: 6, fontSize: 12,
                                background: theme.inputBg, color: theme.textSecondary
                            }}
                        >
                            {t('learnForgetKnown')} ({knownCount})
                        </button>
                    )}
                </>
            )}

            {onExportSrt && (
                <button
                    onClick={onExportSrt}
                    title={t('exportSrtHint')}
                    style={{
                        marginTop: 12, width: '100%', padding: '6px 0',
                        borderRadius: 6, fontSize: 12,
                        background: theme.inputBg, color: theme.textSecondary
                    }}
                >
                    {t('exportSrt')}
                </button>
            )}

            {onRetranscribe && (
                <button
                    onClick={() => { onRetranscribe(); onClose(); }}
                    title={t('retranscribeHint')}
                    style={{
                        marginTop: 12, width: '100%', padding: '6px 0',
                        borderRadius: 6, fontSize: 12,
                        background: theme.inputBg, color: theme.textSecondary
                    }}
                >
                    {t('retranscribe')}
                </button>
            )}
        </>
    );
};
