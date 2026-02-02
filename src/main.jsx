import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n.jsx';
import { ThemeProvider } from './theme.jsx';
import App from './App';
import { MiniPlayer } from './features/mini-player/MiniPlayer.jsx';
import './index.css';

const isMiniPlayer = new URLSearchParams(window.location.search).get('mode') === 'mini-player';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ThemeProvider>
            <I18nProvider>
                {isMiniPlayer ? <MiniPlayer /> : <App />}
            </I18nProvider>
        </ThemeProvider>
    </StrictMode>
);
