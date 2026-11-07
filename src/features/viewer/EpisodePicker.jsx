import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../../theme.jsx';

const nameOf = (p) => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

// Switch episode without leaving the player — the move a show makes you do
// twenty times an evening.
export const EpisodePicker = ({ files, currentIndex, onPick, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();
    const activeRef = useRef(null);

    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'center' });
    }, []);

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

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'absolute', bottom: 64, right: 12, zIndex: 8,
                width: 290, maxHeight: '62vh', overflowY: 'auto',
                padding: 6,
                background: theme.dialogBg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 10,
                boxShadow: '0 12px 36px rgba(0,0,0,0.45)'
            }}
        >
            <div style={{
                padding: '6px 10px 8px', fontSize: 11, color: theme.textTertiary,
                borderBottom: `1px solid ${theme.border}`, marginBottom: 4
            }}>
                {t('episodesCount').replace('{n}', files.length)}
            </div>

            {files.map((file, i) => (
                <button
                    key={file}
                    ref={i === currentIndex ? activeRef : undefined}
                    onClick={() => { onPick(i); onClose(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 9,
                        width: '100%', padding: '8px 10px', borderRadius: 6,
                        textAlign: 'left', cursor: 'pointer',
                        background: i === currentIndex ? theme.accentBg : 'transparent',
                        color: i === currentIndex ? theme.accent : theme.textSecondary
                    }}
                    onMouseEnter={(e) => {
                        if (i !== currentIndex) e.currentTarget.style.background = theme.hoverBg;
                    }}
                    onMouseLeave={(e) => {
                        if (i !== currentIndex) e.currentTarget.style.background = 'transparent';
                    }}
                >
                    <span style={{
                        flex: 'none', minWidth: 22, height: 20, borderRadius: 4,
                        display: 'grid', placeItems: 'center', fontSize: 10,
                        background: i === currentIndex ? theme.accent : theme.inputBg,
                        color: i === currentIndex ? '#fff' : theme.textTertiary,
                        fontWeight: i === currentIndex ? 700 : 400
                    }}>
                        {i + 1}
                    </span>
                    <span style={{
                        flex: 1, minWidth: 0, fontSize: 12.5,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                        {nameOf(file)}
                    </span>
                </button>
            ))}
        </div>
    );
};
