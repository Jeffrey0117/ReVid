import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../theme.jsx';
import { subscribePanels } from './pluginRuntime';

// Renders a plugin's DOM node. Plugins are framework-free: they get an element
// and own what goes inside it.
function PanelBody({ panel }) {
    const hostRef = useRef(null);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return;
        try {
            panel.mount(el);
        } catch (e) {
            console.error(`[plugin:${panel.pluginId}] mount failed`, e);
            el.textContent = `Plugin error: ${e.message}`;
        }
        return () => {
            try { panel.unmount?.(el); } catch (e) { console.error(`[plugin:${panel.pluginId}] unmount failed`, e); }
            el.innerHTML = '';
        };
    }, [panel]);

    return <div ref={hostRef} />;
}

// Buttons for every panel plugins have registered, plus the open one's body.
export const PluginPanelHost = () => {
    const { theme } = useTheme();
    const [panels, setPanels] = useState([]);
    const [openId, setOpenId] = useState(null);

    useEffect(() => subscribePanels(setPanels), []);

    // A plugin that unregisters while open must not leave a dangling panel.
    useEffect(() => {
        if (openId && !panels.some(p => p.id === openId)) setOpenId(null);
    }, [panels, openId]);

    useEffect(() => {
        if (!openId) return;
        const close = () => setOpenId(null);
        const onKey = (e) => { if (e.key === 'Escape') setOpenId(null); };
        window.addEventListener('click', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [openId]);

    if (panels.length === 0) return null;
    const open = panels.find(p => p.id === openId);

    return (
        <>
            {panels.map((p) => (
                <button
                    key={p.id}
                    title={p.title}
                    onClick={(e) => { e.stopPropagation(); setOpenId(openId === p.id ? null : p.id); }}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        height: 28, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
                        fontSize: 11, fontWeight: 600,
                        background: openId === p.id ? 'rgba(59,130,246,0.85)' : 'rgba(0,0,0,0.55)',
                        color: '#fff', border: '1px solid rgba(255,255,255,0.15)'
                    }}
                >
                    {p.icon || p.title}
                </button>
            ))}

            {open && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute', top: 48, right: 12, zIndex: 7,
                        minWidth: 240, maxWidth: 340, padding: 14,
                        background: theme.dialogBg, color: theme.text,
                        border: `1px solid ${theme.border}`, borderRadius: 10,
                        boxShadow: '0 10px 32px rgba(0,0,0,0.4)'
                    }}
                >
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        marginBottom: 10
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{open.title}</span>
                        <button onClick={() => setOpenId(null)} style={{ color: theme.textTertiary, fontSize: 15 }}>
                            {'✕'}
                        </button>
                    </div>
                    <PanelBody panel={open} />
                </div>
            )}
        </>
    );
};
