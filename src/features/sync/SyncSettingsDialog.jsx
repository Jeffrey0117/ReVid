import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import { useLetMeUse } from '../../hooks/useLetMeUse';
import { normalizeBaseUrl } from './syncConfig.js';

const STATUS_COLORS = {
  idle: '#22c55e', syncing: '#3b82f6', offline: '#f59e0b',
  unauthorized: '#ef4444', error: '#ef4444'
};

const formatTime = (ts, lang) => (ts ? new Date(ts).toLocaleString(lang === 'en' ? 'en-US' : 'zh-TW') : '—');

/**
 * Cloud-sync settings: on/off, server URL, LetMeUse login, status, sync now.
 * `sync` is the object returned by useTheaterSync().
 */
export const SyncSettingsDialog = ({ isOpen, onClose, sync }) => {
  const { t, lang } = useI18n();
  const { theme, isDark } = useTheme();
  const { user, isAuthenticated, login, logout } = useLetMeUse();
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUrl(sync.baseUrl);
    setEnabled(sync.configEnabled);
    setSaved(false);
  }, [isOpen, sync.baseUrl, sync.configEnabled]);

  if (!isOpen) return null;

  const trimmed = url.trim();
  const urlValid = !!normalizeBaseUrl(trimmed);
  const urlError = trimmed && !urlValid ? t('syncUrlInvalid') : null;
  const canSave = !enabled || urlValid;

  const handleSave = () => {
    if (!canSave) return;
    sync.setConfig({ enabled, baseUrl: trimmed });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const muted = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const text = isDark ? '#fff' : '#1f2937';
  const inputStyle = {
    width: '100%', padding: '8px 12px', fontSize: 14, borderRadius: 8,
    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    border: `1px solid ${urlError ? '#ef4444' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')}`,
    color: text, outline: 'none'
  };
  const labelStyle = { fontSize: 13, fontWeight: 500, color: muted, marginBottom: 4, display: 'block' };
  const secondaryBtn = {
    padding: '8px 16px', fontSize: 14, fontWeight: 500, borderRadius: 8, border: 'none', cursor: 'pointer',
    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)'
  };
  const statusColor = STATUS_COLORS[sync.status] || muted;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440, maxWidth: '90vw', padding: 20, borderRadius: 16,
          background: isDark ? '#1a1a1a' : '#fff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, color: text }}>{t('syncTitle')}</h3>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, color: muted, display: 'flex' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <p style={{ fontSize: 12, color: muted, marginBottom: 16, lineHeight: 1.5 }}>{t('syncDescription')}</p>

        {/* Account */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, marginBottom: 14,
          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: text }}>
              {isAuthenticated ? (user?.displayName || user?.email || t('syncSignedIn')) : t('syncNotSignedIn')}
            </div>
            {isAuthenticated && user?.email && user?.displayName && (
              <div style={{ fontSize: 12, color: muted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            )}
          </div>
          <button onClick={isAuthenticated ? logout : login} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 13 }}>
            {isAuthenticated ? t('syncSignOut') : t('syncSignIn')}
          </button>
        </div>

        {/* Enable */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, cursor: 'pointer', fontSize: 14, color: text }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: theme.accent }} />
          {t('syncEnable')}
        </label>

        {/* Server URL */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>{t('syncServerUrl')}</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://sync.example.com"
            style={inputStyle}
          />
          <div style={{ fontSize: 12, marginTop: 4, color: urlError ? '#ef4444' : muted }}>
            {urlError || t('syncUrlHint')}
          </div>
        </div>

        {/* Status */}
        <div style={{ fontSize: 13, color: muted, marginBottom: 16, lineHeight: 1.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: statusColor, flexShrink: 0 }} />
            <span style={{ color: text }}>{t(`syncStatus_${sync.status}`)}</span>
          </div>
          {sync.error && sync.status !== 'idle' && sync.status !== 'syncing' && (
            <div style={{ color: '#ef4444', fontSize: 12 }}>{sync.error}</div>
          )}
          <div>{t('syncLastSynced')}: {formatTime(sync.lastSyncedAt, lang)}</div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            onClick={sync.syncNow}
            disabled={!sync.enabled || !isAuthenticated || sync.status === 'syncing'}
            style={{ ...secondaryBtn, opacity: !sync.enabled || !isAuthenticated || sync.status === 'syncing' ? 0.5 : 1 }}
          >
            {t('syncNow')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={secondaryBtn}>{t('cancel')}</button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              style={{
                ...secondaryBtn, color: '#fff', background: saved ? '#22c55e' : theme.accent,
                opacity: canSave ? 1 : 0.5
              }}
            >
              {saved ? t('saved') : t('syncSave')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
