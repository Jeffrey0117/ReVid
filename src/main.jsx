import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n.jsx';
import { ThemeProvider } from './theme.jsx';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ThemeProvider>
            <I18nProvider>
                <App />
            </I18nProvider>
        </ThemeProvider>
    </StrictMode>
);
