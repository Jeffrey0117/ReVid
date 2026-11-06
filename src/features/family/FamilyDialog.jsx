import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import 'family-kit/renderer.js';

// 鴨鴨家族：同一家的其他桌面 app（DuckShot / RePic），已裝顯示「開啟」、未裝一鍵下載安裝。
// 面板本體是 family-kit 的純 DOM 元件；這裡只做對話框外殼與把 ReVid 主題色餵成 CSS 變數。
const themeVars = (isDark) => ({
  '--text-primary': isDark ? 'rgba(255,255,255,0.9)' : '#1f2937',
  '--text-secondary': isDark ? 'rgba(255,255,255,0.55)' : '#6b7280',
  '--text-tertiary': isDark ? 'rgba(255,255,255,0.35)' : '#9ca3af',
  '--background-secondary': isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  '--background-tertiary': isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
  '--border-color': isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
  '--primary-blue': '#3b82f6',
});

export const FamilyDialog = ({ isOpen, onClose }) => {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const el = ref.current;
    if (!el || !window.FamilyKit || !window.familyKit) return undefined;
    const handle = window.FamilyKit.mount(el, window.familyKit, {
      title: t('familyTitle'),
      subtitle: t('familySubtitle'),
    });
    return () => handle.destroy();
  }, [isOpen, t]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...themeVars(isDark),
          width: 460, maxWidth: '92vw', borderRadius: 16, padding: 20,
          background: isDark ? '#1a1a1a' : '#ffffff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        {window.familyKit ? <div ref={ref} /> : <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('familyUnavailable')}</div>}
        <div style={{ textAlign: 'right', marginTop: 14 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', fontSize: 14, fontWeight: 500, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)',
            }}
          >
            {t('familyClose')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default FamilyDialog;
