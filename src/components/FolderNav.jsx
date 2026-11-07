import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../theme.jsx';

const getElectronAPI = () => window.electronAPI || null;

const partsOf = (p) => (p || '').split(/[\\/]/).filter(Boolean);

// The folder button used to only reopen the OS picker, which starts somewhere
// unhelpful and loses where you were. Walking up and down happens here
// instead: the path is the control.
export const FolderNav = ({ folder, onNavigate, onPick, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const [nav, setNav] = useState(null);
    const ref = useRef(null);

    useEffect(() => {
        const api = getElectronAPI();
        if (!api?.folderNav || !folder) return;
        setNav(api.folderNav(folder));
    }, [folder]);

    useEffect(() => {
        const close = () => onClose();
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('click', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    // Each crumb is a real folder to jump to, built back up from its parts.
    const crumbs = useMemo(() => {
        const parts = partsOf(folder);
        const sep = (folder || '').includes('\\') ? '\\' : '/';
        const lead = (folder || '').startsWith('/') ? '/' : '';
        return parts.map((name, i) => ({
            name,
            path: lead + parts.slice(0, i + 1).join(sep)
        }));
    }, [folder]);

    if (!nav) return null;

    const go = (p) => { onNavigate(p); onClose(); };

    return (
        <div
            ref={ref}
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'absolute', top: 36, left: 8, zIndex: 300,
                width: 360, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
                background: theme.dialogBg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 10,
                boxShadow: '0 14px 40px rgba(0,0,0,0.45)'
            }}
        >
            <div style={{
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
                padding: '10px 12px', borderBottom: `1px solid ${theme.border}`,
                fontSize: 11
            }}>
                {crumbs.map((c, i) => (
                    <span key={c.path} style={{ display: 'flex', alignItems: 'center' }}>
                        {i > 0 && <span style={{ color: theme.textTertiary, margin: '0 2px' }}>{'›'}</span>}
                        <button
                            onClick={() => go(c.path)}
                            style={{
                                padding: '2px 5px', borderRadius: 4, cursor: 'pointer',
                                color: i === crumbs.length - 1 ? theme.text : theme.textTertiary,
                                fontWeight: i === crumbs.length - 1 ? 600 : 400
                            }}
                        >
                            {c.name}
                        </button>
                    </span>
                ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
                {nav.parent && (
                    <button
                        onClick={() => go(nav.parent)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                            padding: '8px 10px', borderRadius: 6, textAlign: 'left',
                            cursor: 'pointer', fontSize: 13, color: theme.textSecondary
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = theme.hoverBg; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <span style={{ color: theme.textTertiary }}>{'↑'}</span>
                        {t('folderUp')}
                    </button>
                )}

                {nav.children.length === 0 && !nav.parent && (
                    <div style={{ padding: '16px 10px', fontSize: 12, color: theme.textTertiary }}>
                        {t('folderNoSub')}
                    </div>
                )}

                {nav.children.map(child => (
                    <button
                        key={child.path}
                        onClick={() => go(child.path)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                            padding: '8px 10px', borderRadius: 6, textAlign: 'left',
                            cursor: 'pointer', fontSize: 13,
                            color: child.hasVideos ? theme.text : theme.textTertiary
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = theme.hoverBg; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <span style={{ color: child.hasVideos ? theme.accent : theme.textTertiary }}>
                            {child.hasVideos ? '▸' : '·'}
                        </span>
                        <span style={{
                            flex: 1, minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}>
                            {child.name}
                        </span>
                    </button>
                ))}
            </div>

            <button
                onClick={() => { onPick(); onClose(); }}
                style={{
                    padding: '9px 0', fontSize: 12, cursor: 'pointer',
                    borderTop: `1px solid ${theme.border}`, color: theme.textTertiary
                }}
            >
                {t('folderBrowseElsewhere')}
            </button>
        </div>
    );
};
