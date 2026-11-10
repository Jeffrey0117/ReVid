import { useState } from 'react';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { isRemoteSource, downloadNameFor } from '../utils/remoteSource';

// Paste a link: watch it now, or keep it.
//
// Downloading is the better of the two when the link is worth keeping — a
// file on disk gets subtitles, transcription and everything else, which a
// stream cannot have. So both are offered side by side rather than hiding
// the one that leads to the fuller experience.
export const PlayUrlDialog = ({ onPlay, onDownload, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [url, setUrl] = useState('');
    const [touched, setTouched] = useState(false);

    const trimmed = url.trim();
    const valid = isRemoteSource(trimmed);
    const showError = touched && trimmed.length > 0 && !valid;

    const go = (fn) => {
        if (!valid) { setTouched(true); return; }
        fn(trimmed);
        onClose();
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 100,
                background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: 460, maxWidth: 'calc(100vw - 32px)',
                    background: theme.panelBg || theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 12, padding: 18,
                    boxShadow: '0 16px 48px rgba(0,0,0,0.45)'
                }}
            >
                <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                    {t('playUrl')}
                </div>
                <div style={{ fontSize: 11, color: theme.textTertiary, margin: '4px 0 12px' }}>
                    {t('playUrlHint')}
                </div>

                <input
                    autoFocus
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => setTouched(true)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') go(onPlay);
                        if (e.key === 'Escape') onClose();
                    }}
                    placeholder="https://…/video.m3u8"
                    spellCheck={false}
                    style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '9px 11px', borderRadius: 7, fontSize: 13,
                        background: theme.inputBg, color: theme.text,
                        border: `1px solid ${showError ? '#ef4444' : theme.border}`,
                        outline: 'none'
                    }}
                />
                <div style={{ minHeight: 16, marginTop: 5, fontSize: 11, color: '#ef4444' }}>
                    {showError ? t('playUrlBad') : ''}
                </div>

                {valid && (
                    <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 10 }}>
                        {downloadNameFor(trimmed)}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                        onClick={() => go(onPlay)}
                        disabled={!valid}
                        style={{
                            flex: 1, padding: '9px 0', borderRadius: 7, fontSize: 13,
                            fontWeight: 600, border: 'none',
                            background: valid ? theme.accent : theme.inputBg,
                            color: valid ? '#fff' : theme.textTertiary,
                            cursor: valid ? 'pointer' : 'default'
                        }}
                    >
                        {t('playUrlPlay')}
                    </button>
                    <button
                        onClick={() => go(onDownload)}
                        disabled={!valid}
                        style={{
                            flex: 1, padding: '9px 0', borderRadius: 7, fontSize: 13,
                            border: `1px solid ${theme.border}`,
                            background: 'transparent',
                            color: valid ? theme.text : theme.textTertiary,
                            cursor: valid ? 'pointer' : 'default'
                        }}
                    >
                        {t('playUrlDownload')}
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '9px 14px', borderRadius: 7, fontSize: 13,
                            border: `1px solid ${theme.border}`,
                            background: 'transparent', color: theme.textSecondary,
                            cursor: 'pointer'
                        }}
                    >
                        {t('cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
};
