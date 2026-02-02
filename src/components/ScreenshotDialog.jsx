import { useState, useCallback, useEffect } from 'react';

const getElectronAPI = () => window.electronAPI || null;

const STEP = { CONFIG: 'config', PROCESSING: 'processing', DONE: 'done' };

export const ScreenshotDialog = ({ videoPath, videoDuration, onClose }) => {
  const [interval, setInterval_] = useState(5);
  const [format, setFormat] = useState('jpg');
  const [outputDir, setOutputDir] = useState('');
  const [step, setStep] = useState(STEP.CONFIG);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const estimatedCount = videoDuration > 0
    ? Math.floor(videoDuration / interval) + 1
    : 0;

  useEffect(() => {
    const api = getElectronAPI();
    if (api?.path?.dirname && videoPath) {
      setOutputDir(api.path.dirname(videoPath));
    }
  }, [videoPath]);

  const handleSelectDir = useCallback(async () => {
    const api = getElectronAPI();
    if (!api) return;
    const dir = await api.selectOutputDirectory();
    if (dir) setOutputDir(dir);
  }, []);

  const handleStart = useCallback(async () => {
    const api = getElectronAPI();
    if (!api || !videoPath || !outputDir) return;

    setStep(STEP.PROCESSING);
    setProgress(0);
    setError(null);

    try {
      const res = await api.extractScreenshots({
        inputPath: videoPath,
        outputDir,
        interval,
        format,
        totalDuration: videoDuration
      }, (pct) => setProgress(pct));

      if (res.success) {
        setResult(res);
        setStep(STEP.DONE);
      } else {
        setError(res.error || 'Failed');
        setResult(res);
        setStep(STEP.DONE);
      }
    } catch (err) {
      setError(err.message || String(err));
      setStep(STEP.DONE);
    }
  }, [videoPath, outputDir, interval, format, videoDuration]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const folderName = outputDir
    ? (getElectronAPI()?.path?.basename?.(outputDir) || outputDir.split(/[\\/]/).pop())
    : '';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
      onClick={(e) => { if (e.target === e.currentTarget && step !== STEP.PROCESSING) onClose(); }}
    >
      <div style={{
        background: '#1a1a1a',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 24,
        width: 400,
        maxWidth: '90vw'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
            Extract Screenshots
          </h3>
          <button
            onClick={onClose}
            disabled={step === STEP.PROCESSING}
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, padding: '2px 6px' }}
          >
            {'\u2715'}
          </button>
        </div>

        {step === STEP.CONFIG && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Interval */}
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                Capture every (seconds)
              </label>
              <input
                type="number"
                min={0.5}
                max={300}
                step={0.5}
                value={interval}
                onChange={(e) => setInterval_(Math.max(0.5, parseFloat(e.target.value) || 1))}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6, color: '#fff', fontSize: 14,
                  outline: 'none'
                }}
              />
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                ~{estimatedCount} screenshots
              </p>
            </div>

            {/* Format */}
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                Format
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['jpg', 'png'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 500,
                      background: format === f ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                      color: format === f ? '#fff' : 'rgba(255,255,255,0.55)',
                      transition: 'all 0.15s'
                    }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Output directory */}
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                Output folder
              </label>
              <button
                onClick={handleSelectDir}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6, color: 'rgba(255,255,255,0.7)', fontSize: 13,
                  textAlign: 'left',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                {folderName || 'Select folder...'}
              </button>
            </div>

            {/* Start button */}
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={!outputDir || estimatedCount === 0}
              style={{ width: '100%', marginTop: 4 }}
            >
              Extract {estimatedCount} Screenshots
            </button>
          </div>
        )}

        {step === STEP.PROCESSING && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>
              Extracting screenshots...
            </p>
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: '#3b82f6', borderRadius: 999,
                transition: 'width 0.3s', width: `${progress}%`
              }} />
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
              {progress}%
            </p>
          </div>
        )}

        {step === STEP.DONE && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            {error ? (
              <>
                <p style={{ fontSize: 14, color: '#f87171', marginBottom: 8 }}>Failed</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{error}</p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: '#4ade80', marginBottom: 8 }}>
                  Extracted {result?.count || 0} screenshots
                </p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Saved to {folderName}
                </p>
              </>
            )}
            <button
              className="btn btn-ghost"
              onClick={onClose}
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
