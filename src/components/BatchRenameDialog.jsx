import { useState, useCallback, useEffect, useMemo } from 'react';

const getElectronAPI = () => window.electronAPI || null;

const STEP = { CONFIG: 'config', PREVIEW: 'preview', DONE: 'done' };

function applyPattern(pattern, file, index, api) {
  const fullName = api?.path?.basename ? api.path.basename(file) : file.split(/[\\/]/).pop();
  const ext = api?.path?.extname ? api.path.extname(file) : (fullName.match(/\.[^.]+$/) || [''])[0];
  const name = fullName.replace(ext, '');
  const dir = api?.path?.dirname ? api.path.dirname(file) : '';
  const pad = (n, len) => String(n).padStart(len, '0');

  let result = pattern
    .replace(/\{name\}/g, name)
    .replace(/\{ext\}/g, ext)
    .replace(/\{index\}/g, String(index + 1))
    .replace(/\{index:(\d+)\}/g, (_, len) => pad(index + 1, parseInt(len)))
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10));

  if (!result.includes('.')) {
    result += ext;
  }

  return { newName: result, newPath: api?.path?.join ? api.path.join(dir, result) : result };
}

export const BatchRenameDialog = ({ files, onClose, onComplete }) => {
  const [pattern, setPattern] = useState('{name}{ext}');
  const [step, setStep] = useState(STEP.CONFIG);
  const [results, setResults] = useState({ success: 0, failed: 0 });

  const api = getElectronAPI();

  const getFileName = useCallback((filePath) => {
    if (api?.path?.basename) return api.path.basename(filePath);
    return filePath.split(/[\\/]/).pop() || filePath;
  }, [api]);

  const previews = useMemo(() => {
    return files.map((file, i) => {
      const { newName } = applyPattern(pattern, file, i, api);
      return { file, oldName: getFileName(file), newName };
    });
  }, [files, pattern, api, getFileName]);

  const hasConflicts = useMemo(() => {
    const names = new Set();
    for (const p of previews) {
      if (names.has(p.newName)) return true;
      names.add(p.newName);
    }
    return false;
  }, [previews]);

  const handleRename = useCallback(async () => {
    if (!api) return;

    let success = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const { newPath } = applyPattern(pattern, files[i], i, api);
      if (newPath === files[i]) {
        success++;
        continue;
      }
      const result = api.renameFile(files[i], newPath);
      if (result.success) success++;
      else failed++;
    }

    setResults({ success, failed });
    setStep(STEP.DONE);
  }, [files, pattern, api]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#1a1a1a', borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 24, width: 500, maxWidth: '90vw',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexShrink: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Batch Rename</h3>
          <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, padding: '2px 6px' }}>{'\u2715'}</button>
        </div>

        {(step === STEP.CONFIG || step === STEP.PREVIEW) && (
          <>
            <div style={{ marginBottom: 16, flexShrink: 0 }}>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                Pattern
              </label>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6, color: '#fff', fontSize: 14,
                  outline: 'none', fontFamily: 'monospace'
                }}
              />
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
                {'{name}'} = original name, {'{ext}'} = extension, {'{index}'} = number, {'{index:3}'} = padded, {'{date}'} = today
              </p>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexShrink: 0 }}>
              {[
                { label: '{index:3}_{name}', pat: '{index:3}_{name}{ext}' },
                { label: '{date}_{name}', pat: '{date}_{name}{ext}' },
                { label: 'video_{index:3}', pat: 'video_{index:3}{ext}' }
              ].map(p => (
                <button
                  key={p.label}
                  onClick={() => setPattern(p.pat)}
                  style={{
                    padding: '4px 8px', borderRadius: 4, fontSize: 11,
                    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
                    fontFamily: 'monospace'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {hasConflicts && (
              <p style={{ fontSize: 12, color: '#f87171', marginBottom: 12, flexShrink: 0 }}>
                Naming conflict detected — some files would have the same name
              </p>
            )}

            <div style={{
              flex: 1, overflow: 'auto', marginBottom: 16,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, maxHeight: 300
            }}>
              {previews.map(({ oldName, newName }, i) => {
                const changed = oldName !== newName;
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    fontSize: 12
                  }}>
                    <span style={{ color: 'rgba(255,255,255,0.4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {oldName}
                    </span>
                    {changed && (
                      <>
                        <span style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{'\u2192'}</span>
                        <span style={{ color: '#4ade80', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {newName}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleRename}
              disabled={hasConflicts || !pattern}
              style={{ width: '100%', flexShrink: 0 }}
            >
              Rename {files.length} Files
            </button>
          </>
        )}

        {step === STEP.DONE && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: '#4ade80', marginBottom: 8 }}>
              Renamed {results.success} files
            </p>
            {results.failed > 0 && (
              <p style={{ fontSize: 12, color: '#f87171' }}>{results.failed} failed</p>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => { onComplete?.(); onClose(); }}
              style={{ marginTop: 16 }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
