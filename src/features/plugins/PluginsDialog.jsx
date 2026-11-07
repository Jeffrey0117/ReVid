import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';
import { reloadPlugins } from './pluginRuntime';

const getElectronAPI = () => window.electronAPI || null;

export const PluginsDialog = ({ onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [plugins, setPlugins] = useState([]);
    const [busy, setBusy] = useState(true);

    const refresh = useCallback(async () => {
        setBusy(true);
        const r = await reloadPlugins();
        setPlugins(r.plugins || []);
        setBusy(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const toggle = async (p) => {
        await getElectronAPI()?.pluginSetEnabled(p.id, !p.enabled);
        refresh();
    };

    const install = async () => {
        const r = await getElectronAPI()?.pluginInstall();
        if (r?.success) refresh();
        else if (r && !r.canceled && r.error) window.alert(r.error);
    };

    const uninstall = async (p) => {
        if (!window.confirm(`${t('pluginUninstallConfirm')}\n${p.name}`)) return;
        await getElectronAPI()?.pluginUninstall(p.id);
        refresh();
    };

    return (
        <div style={{
            position: 'fixed', top: 32, left: 0, right: 0, bottom: 0, zIndex: 320,
            background: theme.overlayBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                width: 560, maxWidth: '92%', maxHeight: '82%',
                display: 'flex', flexDirection: 'column',
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
                            {t('pluginsTitle')}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 2 }}>
                            {t('pluginsHint')}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ color: theme.textTertiary, fontSize: 18, padding: '2px 8px' }}>
                        {'✕'}
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px' }}>
                    {busy && (
                        <div style={{ padding: '18px 0', fontSize: 12, color: theme.textTertiary }}>
                            {t('processing')}
                        </div>
                    )}
                    {!busy && plugins.length === 0 && (
                        <div style={{ padding: '18px 0', fontSize: 12, color: theme.textTertiary }}>
                            {t('pluginsEmpty')}
                        </div>
                    )}
                    {plugins.map((p) => (
                        <div
                            key={p.id}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                padding: '10px 0', borderBottom: `1px solid ${theme.border}`
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={Boolean(p.enabled) && !p.broken}
                                disabled={p.broken}
                                onChange={() => toggle(p)}
                                style={{ accentColor: theme.accent, marginTop: 3 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>
                                    {p.name}
                                    <span style={{ fontSize: 11, color: theme.textTertiary, marginLeft: 6 }}>
                                        v{p.version}
                                    </span>
                                    {p.activated && (
                                        <span style={{ fontSize: 11, color: theme.success, marginLeft: 6 }}>
                                            {t('pluginActive')}
                                        </span>
                                    )}
                                </div>
                                {p.description && (
                                    <div style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                                        {p.description}
                                    </div>
                                )}
                                {p.permissions?.length > 0 && (
                                    <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 3 }}>
                                        {t('pluginPermissions')}: {p.permissions.join(', ')}
                                    </div>
                                )}
                                {p.error && (
                                    <div style={{ fontSize: 11, color: theme.error, marginTop: 3 }}>
                                        {p.error}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => uninstall(p)}
                                style={{
                                    fontSize: 11, color: theme.textTertiary,
                                    padding: '3px 8px', borderRadius: 4, background: theme.inputBg
                                }}
                            >
                                {t('pluginUninstall')}
                            </button>
                        </div>
                    ))}
                </div>

                <div style={{
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                    padding: '12px 18px', borderTop: `1px solid ${theme.border}`
                }}>
                    <button
                        className="btn btn-ghost"
                        style={{ marginRight: 'auto' }}
                        onClick={() => getElectronAPI()?.pluginsOpenFolder()}
                    >
                        {t('pluginOpenFolder')}
                    </button>
                    <button className="btn btn-ghost" onClick={refresh}>{t('pluginReload')}</button>
                    <button className="btn btn-primary" onClick={install}>{t('pluginInstall')}</button>
                </div>
            </div>
        </div>
    );
};
