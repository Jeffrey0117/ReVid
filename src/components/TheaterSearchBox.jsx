import { useState, useEffect, useRef, memo } from 'react';
import { useTheme } from '../theme.jsx';
import { useI18n } from '../i18n.jsx';

/**
 * Course search box. Keystrokes update only this component; the committed
 * value propagates to the parent debounced, so typing doesn't re-render
 * the whole App tree on every character.
 */
export const TheaterSearchBox = memo(function TheaterSearchBox({
  initialValue = '',
  onSearch,
  size = 'sm', // 'sm' = toolbar (fixed 200px), 'md' = side panel (full width)
  autoFocus = false
}) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const timerRef = useRef(null);

  // Both the toolbar and the side-panel box can be mounted at once — when the
  // committed value changes from outside (the other instance), adopt it.
  const lastInitialRef = useRef(initialValue);
  if (initialValue !== lastInitialRef.current) {
    lastInitialRef.current = initialValue;
    if (initialValue !== value) setValue(initialValue);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const update = (v) => {
    setValue(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onSearch(v), 150);
  };

  const clear = () => {
    setValue('');
    clearTimeout(timerRef.current);
    onSearch('');
  };

  const md = size === 'md';

  return (
    <div style={{ position: 'relative', width: md ? undefined : 200 }}>
      <svg width={md ? 14 : 13} height={md ? 14 : 13} viewBox="0 0 24 24" fill="none" stroke={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'} strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: md ? 10 : 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        type="text"
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder={t('searchCourses') || '搜尋…'}
        autoFocus={autoFocus}
        style={{
          width: '100%',
          padding: md ? '8px 28px 8px 30px' : '5px 24px 5px 26px',
          fontSize: md ? 13 : 12,
          borderRadius: md ? 8 : 6,
          outline: 'none',
          background: isDark ? (md ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)') : (md ? '#f3f4f6' : 'rgba(0,0,0,0.05)'),
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          color: isDark ? '#fff' : '#1f2937'
        }}
      />
      {value && (
        <button
          onClick={clear}
          title={t('clear') || 'Clear'}
          style={{ position: 'absolute', right: md ? 6 : 4, top: '50%', transform: 'translateY(-50%)', padding: 2, border: 'none', background: 'transparent', cursor: 'pointer', color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)', display: 'flex' }}
        >
          <svg width={md ? 13 : 12} height={md ? 13 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
});
