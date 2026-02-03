import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';

const STORAGE_KEY = 'revid-upload-config';

export const loadUploadConfig = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

const saveUploadConfig = (config) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {}
};

/**
 * UploadSettings — modal for configuring upload API endpoint.
 */
export const UploadSettings = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();

  const [apiUrl, setApiUrl] = useState('');
  const [authType, setAuthType] = useState('none');
  const [authToken, setAuthToken] = useState('');
  const [customHeaders, setCustomHeaders] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const config = loadUploadConfig();
      if (config) {
        setApiUrl(config.apiUrl || '');
        setAuthType(config.authType || 'none');
        setAuthToken(config.authToken || '');
        setCustomHeaders(config.customHeaders || '');
      }
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    saveUploadConfig({
      apiUrl: apiUrl.trim(),
      authType,
      authToken,
      customHeaders: customHeaders.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isOpen) return null;

  const inputStyle = {
    width: '100%', padding: '8px 12px',
    fontSize: 14, borderRadius: 8,
    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    color: isDark ? '#fff' : '#1f2937',
    outline: 'none', transition: 'border-color 0.15s',
  };

  const labelStyle = {
    fontSize: 13, fontWeight: 500,
    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
    marginBottom: 4, display: 'block',
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, maxWidth: '90vw',
          padding: 20, borderRadius: 16,
          background: isDark ? '#1a1a1a' : '#fff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <h3 style={{
            fontSize: 18, fontWeight: 600,
            color: isDark ? '#fff' : '#1f2937',
          }}>
            {t('uploadSettings')}
          </h3>
          <button
            onClick={onClose}
            style={{
              padding: 6, borderRadius: 8,
              color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)',
              transition: 'background 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* API URL */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t('uploadApiUrl')}</label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.example.com/upload"
            style={inputStyle}
            onFocus={e => e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)'}
            onBlur={e => e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
          />
        </div>

        {/* Auth type */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t('uploadAuthType')}</label>
          <select
            value={authType}
            onChange={(e) => setAuthType(e.target.value)}
            style={{
              ...inputStyle,
              cursor: 'pointer',
            }}
          >
            <option value="none">{t('uploadAuthNone')}</option>
            <option value="bearer">{t('uploadAuthBearer')}</option>
            <option value="apikey">{t('uploadAuthApiKey')}</option>
          </select>
        </div>

        {/* Auth token */}
        {authType !== 'none' && (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('uploadAuthToken')}</label>
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="sk-..."
              style={inputStyle}
              onFocus={e => e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)'}
              onBlur={e => e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            />
          </div>
        )}

        {/* Custom headers */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t('uploadCustomHeaders')}</label>
          <textarea
            value={customHeaders}
            onChange={(e) => setCustomHeaders(e.target.value)}
            placeholder='{"X-Custom-Header": "value"}'
            rows={3}
            style={{
              ...inputStyle,
              resize: 'none',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
            onFocus={e => e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)'}
            onBlur={e => e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px', fontSize: 14, fontWeight: 500,
              borderRadius: 8, transition: 'background 0.15s',
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
              border: 'none', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!apiUrl.trim()}
            style={{
              padding: '8px 16px', fontSize: 14, fontWeight: 500,
              borderRadius: 8, transition: 'background 0.15s',
              background: saved ? '#22c55e' : theme.accent,
              color: '#fff',
              border: 'none', cursor: 'pointer',
              opacity: !apiUrl.trim() ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (apiUrl.trim()) e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={e => { if (apiUrl.trim()) e.currentTarget.style.opacity = '1'; }}
          >
            {saved ? t('saved') : t('uploadSaveConfig')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
