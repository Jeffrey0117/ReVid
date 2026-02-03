import { memo, useState, useCallback } from 'react';
import { useTheme } from '../theme.jsx';
import { useI18n } from '../i18n.jsx';

const PANEL_WIDTH = 280;
const TRANSITION_DURATION = 250;

// Copy button component
const CopyButton = memo(function CopyButton({ text, theme, isDark }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [text]);

    return (
        <button
            onClick={handleCopy}
            style={{
                padding: 4, borderRadius: 4,
                background: 'transparent',
                border: 'none', cursor: 'pointer',
                transition: 'background 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            title={copied ? 'Copied!' : 'Copy'}
        >
            {copied ? (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            ) : (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
            )}
        </button>
    );
});

// Info item component
const InfoItem = memo(function InfoItem({ icon, label, value, theme, isDark }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                color: theme.accent,
                fontWeight: 500, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
                {icon}
                <span>{label}</span>
            </div>
            <div style={{
                color: isDark ? '#fff' : '#1f2937',
                fontSize: 13, fontWeight: 300,
                marginTop: 4, paddingLeft: 24,
                borderLeft: `2px solid ${isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.2)'}`,
            }}>
                {value}
            </div>
        </div>
    );
});

export const InfoPanel = memo(function InfoPanel({ metadata, isVisible = true, mode = 'local' }) {
    const { t, lang } = useI18n();
    const { theme, isDark } = useTheme();

    const formatDate = (date) => {
        if (!date) return t('unknown') || 'Unknown';
        return new Date(date).toLocaleString(lang === 'zh-TW' ? 'zh-TW' : 'en-US');
    };

    const formatSize = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDuration = (seconds) => {
        if (!seconds) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const formatProgress = (position, duration) => {
        if (!position || !duration) return '0%';
        return `${Math.round((position / duration) * 100)}%`;
    };

    const getDomain = (url) => {
        if (!url) return t('unknown') || 'Unknown';
        try {
            return new URL(url).hostname;
        } catch {
            return url.substring(0, 30) + '...';
        }
    };

    const panelStyle = {
        width: isVisible ? PANEL_WIDTH : 0,
        transition: `width ${TRANSITION_DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        overflow: 'hidden',
        height: '100%',
        minHeight: 0,
        background: isDark ? 'rgba(26,26,26,0.9)' : 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(12px)',
        borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)'}`,
        flexShrink: 0,
    };

    // Icons
    const FolderIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    );

    const SizeIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14a9 3 0 0 0 18 0V5" />
            <path d="M3 12a9 3 0 0 0 18 0" />
        </svg>
    );

    const ClockIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );

    const CalendarIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
        </svg>
    );

    const LinkIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
    );

    const GlobeIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
        </svg>
    );

    const PlayIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
    );

    const BarChartIcon = (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" x2="12" y1="20" y2="10" />
            <line x1="18" x2="18" y1="20" y2="4" />
            <line x1="6" x2="6" y1="20" y2="16" />
        </svg>
    );

    const InfoIcon = (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" /><path d="M12 8h.01" />
        </svg>
    );

    return (
        <aside style={panelStyle}>
            <div style={{
                display: 'flex', flexDirection: 'column',
                height: '100%', minHeight: 0,
                padding: 24,
                width: PANEL_WIDTH, minWidth: PANEL_WIDTH,
            }}>
                {metadata ? (
                    <>
                        {/* Header */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            marginBottom: 32, paddingBottom: 16,
                            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                        }}>
                            <span style={{ color: theme.accent }}>{InfoIcon}</span>
                            <h2 style={{
                                fontSize: 12, fontWeight: 600,
                                color: isDark ? '#fff' : '#1f2937',
                                textTransform: 'uppercase', letterSpacing: '0.1em',
                            }}>
                                {t('details') || 'Details'}
                            </h2>
                        </div>

                        {/* Content */}
                        <div style={{
                            flex: 1, overflowY: 'auto',
                            display: 'flex', flexDirection: 'column', gap: 24,
                            paddingRight: 8,
                        }}>
                            {mode === 'theater' ? (
                                <>
                                    {/* Theater/Web video info */}
                                    <InfoItem
                                        icon={PlayIcon}
                                        label={t('videoTitle') || 'Title'}
                                        value={metadata.title || t('unknown') || 'Unknown'}
                                        theme={theme}
                                        isDark={isDark}
                                    />

                                    <InfoItem
                                        icon={GlobeIcon}
                                        label={t('platform') || 'Platform'}
                                        value={metadata.platform || getDomain(metadata.url)}
                                        theme={theme}
                                        isDark={isDark}
                                    />

                                    <InfoItem
                                        icon={LinkIcon}
                                        label={t('videoUrl') || 'URL'}
                                        value={
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                                <a
                                                    href={metadata.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        color: theme.accent,
                                                        textDecoration: 'none',
                                                        wordBreak: 'break-all',
                                                        fontSize: 12, flex: 1,
                                                    }}
                                                    title={metadata.url}
                                                    onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                                                    onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                                                >
                                                    {metadata.url?.length > 35
                                                        ? metadata.url.substring(0, 35) + '...'
                                                        : metadata.url}
                                                </a>
                                                <CopyButton text={metadata.url} theme={theme} isDark={isDark} />
                                            </div>
                                        }
                                        theme={theme}
                                        isDark={isDark}
                                    />

                                    {metadata.progress && (
                                        <>
                                            <InfoItem
                                                icon={ClockIcon}
                                                label={t('duration') || 'Duration'}
                                                value={formatDuration(metadata.progress.duration)}
                                                theme={theme}
                                                isDark={isDark}
                                            />

                                            <InfoItem
                                                icon={BarChartIcon}
                                                label={t('watchProgress') || 'Progress'}
                                                value={
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                        <span>{formatProgress(metadata.progress.lastPosition, metadata.progress.duration)}</span>
                                                        <div style={{
                                                            height: 4, borderRadius: 999,
                                                            background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                                                            overflow: 'hidden',
                                                        }}>
                                                            <div style={{
                                                                height: '100%', borderRadius: 999,
                                                                background: metadata.progress.completed ? '#22c55e' : theme.accent,
                                                                width: `${Math.min(100, (metadata.progress.lastPosition / metadata.progress.duration) * 100)}%`,
                                                            }} />
                                                        </div>
                                                    </div>
                                                }
                                                theme={theme}
                                                isDark={isDark}
                                            />

                                            {metadata.progress.lastWatched && (
                                                <InfoItem
                                                    icon={CalendarIcon}
                                                    label={t('lastWatched') || 'Last Watched'}
                                                    value={formatDate(metadata.progress.lastWatched)}
                                                    theme={theme}
                                                    isDark={isDark}
                                                />
                                            )}
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Local video info */}
                                    <InfoItem
                                        icon={FolderIcon}
                                        label={t('filePath') || 'File Path'}
                                        value={
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                                <span style={{
                                                    wordBreak: 'break-all',
                                                    fontSize: 12, flex: 1,
                                                }} title={metadata.filePath}>
                                                    {metadata.filePath?.length > 35
                                                        ? '...' + metadata.filePath.slice(-35)
                                                        : metadata.filePath}
                                                </span>
                                                <CopyButton text={metadata.filePath} theme={theme} isDark={isDark} />
                                            </div>
                                        }
                                        theme={theme}
                                        isDark={isDark}
                                    />

                                    <InfoItem
                                        icon={SizeIcon}
                                        label={t('fileSize') || 'File Size'}
                                        value={formatSize(metadata.size)}
                                        theme={theme}
                                        isDark={isDark}
                                    />

                                    {metadata.duration && (
                                        <InfoItem
                                            icon={ClockIcon}
                                            label={t('duration') || 'Duration'}
                                            value={formatDuration(metadata.duration)}
                                            theme={theme}
                                            isDark={isDark}
                                        />
                                    )}

                                    {metadata.index !== undefined && metadata.total && (
                                        <InfoItem
                                            icon={BarChartIcon}
                                            label={t('videoIndex') || 'Index'}
                                            value={`${metadata.index + 1} / ${metadata.total}`}
                                            theme={theme}
                                            isDark={isDark}
                                        />
                                    )}

                                    {metadata.mtime && (
                                        <InfoItem
                                            icon={CalendarIcon}
                                            label={t('modifiedDate') || 'Modified'}
                                            value={formatDate(metadata.mtime)}
                                            theme={theme}
                                            isDark={isDark}
                                        />
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer */}
                        <div style={{
                            paddingTop: 16, marginTop: 16,
                            borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                            fontSize: 10,
                            color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
                            textAlign: 'center',
                            textTransform: 'uppercase', letterSpacing: '0.2em',
                        }}>
                            ReVid Engine
                        </div>
                    </>
                ) : (
                    <div style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        height: '100%', textAlign: 'center',
                    }}>
                        <span style={{ color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)', marginBottom: 12 }}>
                            {InfoIcon}
                        </span>
                        <p style={{
                            color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
                            fontSize: 13, fontWeight: 500,
                        }}>
                            {t('details') || 'Details'}
                        </p>
                        <p style={{
                            color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
                            fontSize: 11, marginTop: 4,
                        }}>
                            {t('noVideoSelected') || 'Select a video to view details'}
                        </p>
                    </div>
                )}
            </div>
        </aside>
    );
});
