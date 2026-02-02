import { useState, useCallback, useMemo, createContext, useContext } from 'react';

const THEME_KEY = 'revid-theme';

const themes = {
  dark: {
    bg: '#0a0a0a',
    bgSecondary: '#0f0f0f',
    bgTertiary: 'rgba(255,255,255,0.03)',
    text: '#fff',
    textSecondary: 'rgba(255,255,255,0.7)',
    textTertiary: 'rgba(255,255,255,0.4)',
    border: 'rgba(255,255,255,0.06)',
    borderSecondary: 'rgba(255,255,255,0.1)',
    accent: '#3b82f6',
    accentBg: 'rgba(59,130,246,0.1)',
    cardBg: 'rgba(0,0,0,0.5)',
    overlayBg: 'rgba(0,0,0,0.7)',
    dialogBg: '#1a1a1a',
    inputBg: 'rgba(255,255,255,0.06)',
    hoverBg: 'rgba(255,255,255,0.08)',
    success: '#4ade80',
    error: '#f87171',
    pin: '#fbbf24'
  },
  light: {
    bg: '#f5f5f5',
    bgSecondary: '#ffffff',
    bgTertiary: 'rgba(255,255,255,0.8)',
    text: '#1a1a1a',
    textSecondary: 'rgba(0,0,0,0.65)',
    textTertiary: 'rgba(0,0,0,0.4)',
    border: 'rgba(0,0,0,0.08)',
    borderSecondary: 'rgba(0,0,0,0.12)',
    accent: '#5b8ec9',
    accentBg: 'rgba(91,142,201,0.1)',
    cardBg: 'rgba(0,0,0,0.04)',
    overlayBg: 'rgba(0,0,0,0.4)',
    dialogBg: '#ffffff',
    inputBg: 'rgba(0,0,0,0.04)',
    hoverBg: 'rgba(0,0,0,0.06)',
    success: '#16a34a',
    error: '#dc2626',
    pin: '#d97706'
  }
};

const ThemeContext = createContext(null);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { theme: themes.dark, isDark: true, toggleTheme: () => {} };
  }
  return ctx;
};

export const ThemeProvider = ({ children }) => {
  const [mode, setMode] = useState(() =>
    localStorage.getItem(THEME_KEY) || 'dark'
  );

  const toggleTheme = useCallback(() => {
    setMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  const theme = themes[mode] || themes.dark;
  const isDark = mode === 'dark';

  const value = useMemo(() => ({ theme, isDark, toggleTheme }), [theme, isDark, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
