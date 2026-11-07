import { useState, useRef, useCallback, useMemo } from 'react';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../theme.jsx';
import { formatTime, formatTimePrecise } from '../features/editor/components/TrimTimeline';

const getElectronAPI = () => window.electronAPI || null;

// Matches below this score are shown but not auto-selected: an irreversible
// bulk cut should only pre-check hits that are near-certain.
const AUTO_SELECT_SCORE = 0.85;

// Batch cut: the user marked a "fixed segment" in one video (the template).
// Scan every file in the folder for the same audio, show where it was found,
// then cut each file so everything from the chosen point onward is removed.
export const BatchCutDialog = ({ files, template, onClose }) => {
    const { t } = useI18n();
    const { theme } = useTheme();

    const templateLen = template.end - template.start;

    const [rows, setRows] = useState(() => files.map((p) => ({
        path: p,
        name: p.split(/[\\/]/).pop(),
        status: 'pending', // pending | scanning | found | notfound | cutting | done | failed
        matchStart: 0,
        score: 0,
        targetDuration: 0,
        // Setup phase: which files to scan (default all). After the scan the
        // same flag means "cut this file".
        selected: true,
        error: null
    })));
    const lastClickedRef = useRef(-1);
    const [phase, setPhase] = useState('setup'); // setup | scanning | review | cutting | done
    const [cutFrom, setCutFrom] = useState('start'); // start = delete segment too; end = keep it
    const [replaceOriginal, setReplaceOriginal] = useState(false);
    const [fastCopy, setFastCopy] = useState(true);
    const [activePct, setActivePct] = useState(0);
    const [fatalError, setFatalError] = useState(null);

    const cutPointOf = useCallback((row) => (
        cutFrom === 'start' ? row.matchStart : row.matchStart + templateLen
    ), [cutFrom, templateLen]);

    // A cut point at/after the file's end means there is nothing to remove.
    const nothingToCut = useCallback((row) => (
        row.targetDuration > 0 && cutPointOf(row) >= row.targetDuration - 0.2
    ), [cutPointOf]);

    const selectedRows = useMemo(
        () => rows.filter(r => r.selected && r.status === 'found' && !nothingToCut(r)),
        [rows, nothingToCut]
    );
    const scanTargets = useMemo(() => rows.filter(r => r.selected), [rows]);

    const updateRow = useCallback((path, patch) => {
        setRows(prev => prev.map(r => (r.path === path ? { ...r, ...patch } : r)));
    }, []);

    // A row is toggleable while picking scan targets, and again in review for
    // rows where the segment was actually found.
    const canToggle = useCallback((row) => {
        if (phase === 'setup') return true;
        if (phase === 'review') return row.status === 'found' && !nothingToCut(row);
        return false;
    }, [phase, nothingToCut]);

    // Click toggles one row; Shift+click applies this click's new state to the
    // whole range back to the previously clicked row (file-manager style).
    const toggleRow = useCallback((index, shiftKey) => {
        setRows(prev => {
            if (!canToggle(prev[index])) return prev;
            const next = [...prev];
            if (shiftKey && lastClickedRef.current >= 0 && lastClickedRef.current < prev.length) {
                const lo = Math.min(lastClickedRef.current, index);
                const hi = Math.max(lastClickedRef.current, index);
                const newState = !prev[index].selected;
                for (let i = lo; i <= hi; i++) {
                    if (canToggle(next[i])) next[i] = { ...next[i], selected: newState };
                }
            } else {
                next[index] = { ...next[index], selected: !next[index].selected };
            }
            return next;
        });
        lastClickedRef.current = index;
    }, [canToggle]);

    const setAllSelected = useCallback((value) => {
        setRows(prev => prev.map(r => (canToggle(r) ? { ...r, selected: value } : r)));
    }, [canToggle]);

    const handleScan = useCallback(async () => {
        const api = getElectronAPI();
        if (!api || scanTargets.length === 0) return;
        setPhase('scanning');
        setFatalError(null);
        lastClickedRef.current = -1;

        const result = await api.findSegmentMatches({
            templatePath: template.templatePath,
            templateStart: template.start,
            templateEnd: template.end,
            targets: scanTargets.map(r => r.path)
        }, (p) => {
            if (p.phase === 'scanning') {
                updateRow(p.path, { status: 'scanning' });
            } else if (p.phase === 'done' && p.result) {
                updateRow(p.path, {
                    status: p.result.found ? 'found' : 'notfound',
                    matchStart: p.result.matchStart,
                    score: p.result.score,
                    targetDuration: p.result.targetDuration || 0,
                    // Only near-certain matches are pre-checked; marginal ones
                    // stay visible but unselected for the user to judge.
                    selected: p.result.found && p.result.score >= AUTO_SELECT_SCORE,
                    error: p.result.noAudio ? t('batchCutNoAudio') : null
                });
            }
        });

        if (result.success) {
            setPhase('review');
        } else if (result.cancelled) {
            onClose();
        } else {
            setFatalError(result.error);
            setPhase('setup');
        }
    }, [scanTargets, template, updateRow, onClose, t]);

    const handleCut = useCallback(async () => {
        const api = getElectronAPI();
        if (!api || selectedRows.length === 0) return;
        setPhase('cutting');
        setFatalError(null);
        setActivePct(0);

        const jobs = selectedRows.map(r => ({ inputPath: r.path, cutAt: cutPointOf(r) }));

        const result = await api.batchCutVideos(
            { jobs, replaceOriginal, fastCopy },
            (p) => {
                if (p.phase === 'start') {
                    setActivePct(0);
                    updateRow(p.path, { status: 'cutting' });
                } else if (p.phase === 'done' && p.result) {
                    updateRow(p.path, {
                        status: p.result.success ? 'done' : 'failed',
                        error: p.result.error || null
                    });
                }
            },
            (pct) => setActivePct(pct)
        );

        if (result.cancelled) {
            onClose();
            return;
        }
        if (!result.success && result.error) setFatalError(result.error);
        setPhase('done');
    }, [selectedRows, cutPointOf, replaceOriginal, fastCopy, updateRow, onClose]);

    const handleClose = useCallback(() => {
        const api = getElectronAPI();
        if (phase === 'scanning') api?.cancelFfmpeg?.('segment-scan');
        else if (phase === 'cutting') { api?.cancelFfmpeg?.('batch-cut'); return; } // close on cancelled result
        onClose();
    }, [phase, onClose]);

    const busy = phase === 'scanning' || phase === 'cutting';
    const doneCount = rows.filter(r => r.status === 'done').length;
    const failedCount = rows.filter(r => r.status === 'failed').length;

    const statusLabel = (row) => {
        switch (row.status) {
            case 'pending': return t('batchCutPending');
            case 'scanning': return t('batchCutScanning');
            case 'found':
                if (nothingToCut(row)) return t('batchCutNothingToCut');
                return `${formatTimePrecise(cutPointOf(row))} (${Math.round(row.score * 100)}%)`;
            case 'notfound': return row.error || t('batchCutNotFound');
            case 'cutting': return `${activePct}%`;
            case 'done': return t('batchCutRowDone');
            case 'failed': return row.error || t('batchCutRowFailed');
            default: return '';
        }
    };

    const statusColor = (row) => {
        switch (row.status) {
            case 'found':
                if (nothingToCut(row)) return theme.textTertiary;
                return row.score >= AUTO_SELECT_SCORE ? theme.success : theme.pin;
            case 'notfound': case 'failed': return theme.error;
            case 'cutting': return theme.accent;
            case 'done': return theme.success;
            default: return theme.textTertiary;
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 32, left: 0, right: 0, bottom: 0, zIndex: 300,
            background: theme.overlayBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                width: 600, maxWidth: '92%', maxHeight: '86%',
                display: 'flex', flexDirection: 'column',
                background: theme.dialogBg, borderRadius: 12,
                border: `1px solid ${theme.border}`,
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 18px', borderBottom: `1px solid ${theme.border}`
                }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
                            {t('batchCutTitle')}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 2 }}>
                            {t('batchCutTemplate')}: {template.templatePath.split(/[\\/]/).pop()}{' '}
                            {formatTimePrecise(template.start)} – {formatTimePrecise(template.end)}
                            {' '}({formatTime(templateLen)})
                        </div>
                        <div style={{ fontSize: 12, color: theme.error, marginTop: 2 }}>
                            {t('batchCutMeaning')}
                        </div>
                    </div>
                    <button onClick={handleClose} style={{ color: theme.textTertiary, fontSize: 18, padding: '2px 8px' }}>
                        {'✕'}
                    </button>
                </div>

                {/* File list — whole row toggles; Shift+click selects a range */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px' }}>
                    {rows.map((row, index) => (
                        <div
                            key={row.path}
                            onClick={(e) => toggleRow(index, e.shiftKey)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '7px 4px', borderBottom: `1px solid ${theme.border}`,
                                cursor: canToggle(row) ? 'pointer' : 'default',
                                userSelect: 'none',
                                background: row.selected && canToggle(row) ? theme.accentBg : 'transparent',
                                borderRadius: 4
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={row.selected && (phase === 'setup' || !nothingToCut(row))}
                                disabled={!canToggle(row)}
                                readOnly
                                style={{ accentColor: theme.accent, pointerEvents: 'none' }}
                            />
                            <span style={{
                                flex: 1, fontSize: 13, color: theme.textSecondary,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                            }}>
                                {row.name}
                            </span>
                            <span
                                title={row.status === 'found' && !nothingToCut(row) && row.score < AUTO_SELECT_SCORE
                                    ? t('batchCutLowScore')
                                    : undefined}
                                style={{
                                    fontSize: 12, color: statusColor(row),
                                    fontVariantNumeric: 'tabular-nums', flexShrink: 0
                                }}
                            >
                                {statusLabel(row)}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Options + actions */}
                <div style={{ padding: '12px 18px', borderTop: `1px solid ${theme.border}` }}>
                    {fatalError && (
                        <div style={{ fontSize: 12, color: theme.error, marginBottom: 8 }}>
                            {fatalError}
                        </div>
                    )}
                    {phase === 'review' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.textSecondary, cursor: 'pointer' }}>
                                <input type="radio" checked={cutFrom === 'start'} onChange={() => setCutFrom('start')} style={{ accentColor: theme.accent }} />
                                {t('batchCutFromStart')}
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.textSecondary, cursor: 'pointer' }}>
                                <input type="radio" checked={cutFrom === 'end'} onChange={() => setCutFrom('end')} style={{ accentColor: theme.accent }} />
                                {t('batchCutFromEnd')}
                            </label>
                            <label title={t('editorFastCutHint')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.textSecondary, cursor: 'pointer' }}>
                                <input type="checkbox" checked={fastCopy} onChange={(e) => setFastCopy(e.target.checked)} style={{ accentColor: theme.accent }} />
                                {t('batchCutFast')}
                            </label>
                            <label title={t('editorReplaceHint')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: replaceOriginal ? theme.error : theme.textSecondary }}>
                                <input type="checkbox" checked={replaceOriginal} onChange={(e) => setReplaceOriginal(e.target.checked)} style={{ accentColor: theme.error }} />
                                {t('batchCutReplace')}
                            </label>
                        </div>
                    )}
                    {phase === 'done' && (
                        <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 10 }}>
                            {t('batchCutDoneSummary')}: {doneCount} {t('batchCutRowDone')}
                            {failedCount > 0 && (
                                <span style={{ color: theme.error }}>
                                    {' · '}{failedCount} {t('batchCutRowFailed')}
                                </span>
                            )}
                        </div>
                    )}
                    {phase === 'setup' && (
                        <div style={{ fontSize: 12, color: theme.textTertiary, marginBottom: 8 }}>
                            {t('batchCutSetupHint')}
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                        {(phase === 'setup' || phase === 'review') && (
                            <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                                <button className="btn btn-ghost" onClick={() => setAllSelected(true)}>
                                    {t('batchCutSelectAll')}
                                </button>
                                <button className="btn btn-ghost" onClick={() => setAllSelected(false)}>
                                    {t('batchCutSelectNone')}
                                </button>
                            </div>
                        )}
                        {phase !== 'done' && (
                            <button className="btn btn-ghost" onClick={handleClose}>
                                {t('cancel')}
                            </button>
                        )}
                        {phase === 'setup' && (
                            <button
                                className="btn btn-primary"
                                disabled={scanTargets.length === 0}
                                onClick={handleScan}
                            >
                                {t('batchCutScanBtn')} ({scanTargets.length})
                            </button>
                        )}
                        {phase === 'scanning' && (
                            <span style={{ fontSize: 12, color: theme.textTertiary, alignSelf: 'center' }}>
                                {t('batchCutScanning')}
                            </span>
                        )}
                        {phase === 'review' && (
                            <button
                                className="btn btn-primary"
                                disabled={selectedRows.length === 0}
                                onClick={() => {
                                    if (!replaceOriginal || window.confirm(t('batchCutReplaceConfirm'))) handleCut();
                                }}
                            >
                                {t('batchCutStartBtn')} ({selectedRows.length})
                            </button>
                        )}
                        {phase === 'done' && (
                            <button className="btn btn-primary" onClick={onClose}>
                                {t('batchCutClose')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
