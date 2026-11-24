import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';

const getElectronAPI = () => window.electronAPI || null;

// Hands the open folder to other devices on the same network. Off by
// default, because it exposes files.
export const ShareDialog = ({ folder, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [state, setState] = useState({ running: false });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);
    // The browser extension authenticates to ReVid with this key. It was only
    // ever written to a JSON file in AppData, so the only way to pair the two
    // was to go and find it — which is why the extension side had never been
    // used. It belongs on screen, next to the other thing this machine serves.
    const [grab, setGrab] = useState(null);
    const [keyCopied, setKeyCopied] = useState(false);

    useEffect(() => {
        getElectronAPI()?.lanStatus?.().then(setState).catch(() => {});
        getElectronAPI()?.grabStatus?.().then(setGrab).catch(() => {});
    }, []);

    const copyKey = useCallback(async () => {
        if (!grab?.token) return;
        try {
            await navigator.clipboard.writeText(grab.token);
            setKeyCopied(true);
            setTimeout(() => setKeyCopied(false), 1800);
        } catch (e) { /* denied */ }
    }, [grab]);

    // Rotating invalidates whatever is pasted into the extension, so the new
    // key is shown immediately rather than leaving the pairing silently broken.
    const rotateKey = useCallback(async () => {
        const api = getElectronAPI();
        if (!api?.grabRotate) return;
        try {
            await api.grabRotate();
            setGrab(await api.grabStatus());
            setKeyCopied(false);
        } catch (e) { /* leave the old one showing */ }
    }, []);

    const toggle = useCallback(async () => {
        const api = getElectronAPI();
        if (!api) return;
        setBusy(true);
        setError(null);
        try {
            const next = state.running ? await api.lanStop() : await api.lanStart(folder);
            if (next.success === false) setError(next.error);
            setState(await api.lanStatus());
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }, [state.running, folder]);

    const copy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(state.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch (e) { /* denied */ }
    }, [state.url]);

    return (
        <div style={{
            position: 'fixed', top: 32, left: 0, right: 0, bottom: 0, zIndex: 320,
            background: theme.overlayBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                width: 480, maxWidth: '92%',
                background: theme.dialogBg, borderRadius: 12,
                border: `1px solid ${theme.border}`,
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 18px', borderBottom: `1px solid ${theme.border}`
                }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
                            {t('shareTitle')}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 2 }}>
                            {t('shareSubtitle')}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 18, padding: '2px 8px' }}>
                        {'✕'}
                    </button>
                </div>

                <div style={{ padding: 18 }}>
                    {!folder && (
                        <div style={{ fontSize: 13, color: theme.textTertiary }}>{t('shareNoFolder')}</div>
                    )}

                    {folder && (
                        <>
                            <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 12 }}>
                                {t('shareSharing')}: <span style={{ color: theme.text }}>{folder}</span>
                            </div>

                            <button
                                onClick={toggle}
                                disabled={busy}
                                className={state.running ? 'btn btn-ghost' : 'btn btn-primary'}
                                style={{ width: '100%', padding: '9px 0' }}
                            >
                                {busy ? t('processing') : (state.running ? t('shareStop') : t('shareStart'))}
                            </button>

                            {state.running && state.url && (
                                <div style={{
                                    marginTop: 14, padding: 14, borderRadius: 8,
                                    background: theme.inputBg
                                }}>
                                    <div style={{ fontSize: 12, color: theme.textTertiary, marginBottom: 6 }}>
                                        {t('shareOpenOnPhone')}
                                    </div>
                                    <div style={{
                                        fontSize: 13, wordBreak: 'break-all', color: theme.text,
                                        fontFamily: 'ui-monospace, monospace', lineHeight: 1.5
                                    }}>
                                        {state.url}
                                    </div>
                                    <button
                                        onClick={copy}
                                        style={{
                                            marginTop: 10, padding: '5px 12px', borderRadius: 5, fontSize: 12,
                                            background: theme.accent, color: '#fff'
                                        }}
                                    >
                                        {copied ? t('shareCopied') : t('shareCopy')}
                                    </button>
                                </div>
                            )}

                            {error && (
                                <div style={{ marginTop: 12, fontSize: 12, color: theme.error }}>{error}</div>
                            )}

                            <div style={{
                                marginTop: 16, paddingTop: 12,
                                borderTop: `1px solid ${theme.border}`,
                                fontSize: 11, color: theme.textTertiary, lineHeight: 1.7
                            }}>
                                {t('shareNote1')}<br />
                                {t('shareNote2')}<br />
                                {t('shareNote3')}
                            </div>
                        </>
                    )}

                    {/* Not folder-scoped: the extension pairs with the app, not
                        with whatever happens to be open. */}
                    <div style={{
                        marginTop: folder ? 16 : 0, paddingTop: folder ? 14 : 0,
                        borderTop: folder ? `1px solid ${theme.border}` : 'none'
                    }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
                            {t('grabTitle')}
                        </div>
                        <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 3, lineHeight: 1.6 }}>
                            {t('grabHint')}
                        </div>

                        {grab?.running ? (
                            <div style={{
                                marginTop: 10, padding: 12, borderRadius: 8, background: theme.inputBg
                            }}>
                                <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 5 }}>
                                    {t('grabPort')}: <span style={{ fontFamily: 'ui-monospace, monospace' }}>127.0.0.1:{grab.port}</span>
                                </div>
                                <div style={{
                                    fontSize: 13, wordBreak: 'break-all', color: theme.text,
                                    fontFamily: 'ui-monospace, monospace', lineHeight: 1.5
                                }}>
                                    {grab.token}
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                    <button
                                        onClick={copyKey}
                                        style={{
                                            padding: '5px 12px', borderRadius: 5, fontSize: 12,
                                            background: theme.accent, color: '#fff'
                                        }}
                                    >
                                        {keyCopied ? t('shareCopied') : t('grabCopyKey')}
                                    </button>
                                    <button
                                        onClick={rotateKey}
                                        title={t('grabRotateHint')}
                                        style={{
                                            padding: '5px 12px', borderRadius: 5, fontSize: 12,
                                            background: 'transparent', color: theme.textSecondary,
                                            border: `1px solid ${theme.border}`
                                        }}
                                    >
                                        {t('grabRotate')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ marginTop: 10, fontSize: 12, color: theme.textTertiary }}>
                                {t('grabNotRunning')}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
