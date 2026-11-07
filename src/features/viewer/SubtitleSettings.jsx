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
    timeShift: 0        // seconds added to every cue time
};

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

// Small popover for subtitle appearance. Values apply live and persist.
export const SubtitleSettings = ({ style, onChange, onClose, onRetranscribe }) => {
    const { t } = useI18n();
    const { theme } = useTheme();

    const [translate, setTranslateState] = useState(readTranslateSettings);

    const set = (patch) => {
        const next = { ...style, ...patch };
        localStorage.setItem(SUBTITLE_STYLE_KEY, JSON.stringify(next));
        onChange(next);
    };

    const setTranslate = (patch) => {
        const next = { ...translate, ...patch };
        localStorage.setItem(TRANSLATE_ENGINE_KEY, next.engine);
        localStorage.setItem(GEMINI_KEY, next.apiKey);
        localStorage.setItem(AUTO_TRANSLATE_KEY, next.auto ? 'on' : 'off');
        setTranslateState(next);
    };

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                width: 250, padding: 14,
                background: theme.dialogBg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 10,
                boxShadow: '0 10px 32px rgba(0,0,0,0.4)'
            }}
        >
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 12
            }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t('subStyleTitle')}</span>
                <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 15 }}>{'✕'}</button>
            </div>

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
                <input
                    type="range" min="8" max="240" step="4"
                    value={style.offset}
                    onChange={(e) => set({ offset: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: theme.accent }}
                />
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

            <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: theme.textSecondary, cursor: 'pointer'
            }}>
                <input
                    type="checkbox"
                    checked={translate.auto}
                    onChange={(e) => setTranslate({ auto: e.target.checked })}
                    style={{ accentColor: theme.accent }}
                />
                {t('translateAuto')}
            </label>

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
        </div>
    );
};
