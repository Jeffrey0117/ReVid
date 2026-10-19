import { useState, useEffect, useCallback, useRef } from 'react';
import { useLetMeUse } from '../../hooks/useLetMeUse';
import { collectDirty } from '../../utils/syncMerge.js';
import { syncOnce, retryDelayFor } from './syncEngine.js';
import { normalizeBaseUrl, SYNC_TIMING } from './syncConfig.js';

const getElectronAPI = () => window.electronAPI || null;
// Always the *current* token — the SDK refreshes it before expiry.
const currentToken = () => window.letmeuse?.getToken?.() || null;

const statusForFailure = (failure) => {
  if (failure?.code === 'UNAUTHORIZED') return 'unauthorized';
  if (failure?.code === 'OFFLINE') return 'offline';
  return 'error';
};

/**
 * Keeps the theater library in sync with the cloud (docs/SYNC-API.md §6).
 *
 * status: 'loading' | 'disabled' | 'signed_out' | 'idle' | 'syncing'
 *       | 'offline' | 'unauthorized' | 'error'
 */
export function useTheaterSync(theater) {
  const { token, isAuthenticated } = useLetMeUse();
  const [syncState, setSyncState] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [clockSkewed, setClockSkewed] = useState(false); // local clock vs X-Server-Time (§4.4)

  const stateRef = useRef(null);
  const theaterRef = useRef(theater);
  theaterRef.current = theater;
  const userIdRef = useRef(null);
  const inFlightRef = useRef(false);
  const againRef = useRef(false);
  const timerRef = useRef(null);
  const timerDueRef = useRef(Infinity);
  const attemptRef = useRef(0);
  const scheduleRef = useRef(null); // breaks the syncNow ↔ schedule cycle

  const enabled = !!syncState?.enabled && !!normalizeBaseUrl(syncState?.baseUrl);

  const persist = useCallback((next) => {
    stateRef.current = next;
    setSyncState(next);
    getElectronAPI()?.saveSyncState?.(next);
  }, []);

  // Load sync-state.json once.
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.loadSyncState) { setStatus('disabled'); return; }
    api.loadSyncState().then((r) => {
      if (r?.success) {
        stateRef.current = r.state;
        setSyncState(r.state);
      } else {
        setStatus('error');
        setError(r?.error || 'Could not load sync state');
      }
    });
  }, []);

  const runOnce = useCallback(async () => {
    const api = getElectronAPI();
    const state = stateRef.current;
    const baseUrl = normalizeBaseUrl(state?.baseUrl);
    if (!api?.syncRequest || !state?.enabled || !baseUrl) { setStatus('disabled'); return; }
    if (!theaterRef.current.isLoaded) return; // library failed to load → never sync over it
    const tok = currentToken();
    if (!tok) { setStatus('signed_out'); return; }

    setStatus('syncing');
    const request = async (method, route, body) => {
      const res = await api.syncRequest({ baseUrl, method, route, token: currentToken() || tok, body });
      // §4.4: LWW relies on wall clocks; warn in settings past 60s of skew.
      if (res?.serverTime) setClockSkewed(Math.abs(Date.now() - res.serverTime) > SYNC_TIMING.clockSkewMax);
      return res;
    };
    const result = await syncOnce({
      request,
      state,
      verifiedUserId: userIdRef.current,
      getFolders: () => theaterRef.current.allFolders,
      applyFolders: (base, merged, reapply) => {
        theaterRef.current.replaceAllFolders((prev) => (prev === base ? merged : reapply(prev)));
      }
    });

    if (!result.ok) {
      if (result.failure?.code === 'UNAUTHORIZED') userIdRef.current = null;
      setStatus(statusForFailure(result.failure));
      setError(result.failure?.error || 'Sync failed');
      const delay = retryDelayFor(result.failure, attemptRef.current);
      attemptRef.current += 1;
      return delay;
    }
    attemptRef.current = 0;
    userIdRef.current = result.userId;
    // Keep config edits made while this round was in flight.
    persist({ ...result.state, enabled: stateRef.current.enabled, baseUrl: stateRef.current.baseUrl });
    setStatus('idle');
    setError(null);
    return null;
  }, [persist]);

  // Serialize rounds; a request during a round queues exactly one more.
  const syncNow = useCallback(async () => {
    if (inFlightRef.current) { againRef.current = true; return; }
    inFlightRef.current = true;
    clearTimeout(timerRef.current);
    timerDueRef.current = Infinity;
    let retryIn = null;
    try {
      do {
        againRef.current = false;
        retryIn = await runOnce();
      } while (againRef.current && retryIn == null);
    } catch (e) {
      setStatus('error');
      setError(e?.message || 'Sync failed');
    } finally {
      inFlightRef.current = false;
    }
    if (retryIn != null) scheduleRef.current?.(retryIn);
  }, [runOnce]);

  // Run at `delay` from now unless something is already due sooner.
  const schedule = useCallback((delay) => {
    const due = Date.now() + delay;
    if (due >= timerDueRef.current) return;
    clearTimeout(timerRef.current);
    timerDueRef.current = due;
    timerRef.current = setTimeout(() => { timerDueRef.current = Infinity; syncNow(); }, delay);
  }, [syncNow]);
  scheduleRef.current = schedule;

  // Start / restart on enable, server change, login, or once the library has
  // loaded. Deliberately not keyed on the whole syncState: every round saves
  // it, which would loop.
  const stateLoaded = syncState !== null;
  const baseUrl = syncState?.baseUrl || '';
  useEffect(() => {
    if (!stateLoaded) return;
    if (!enabled) { setStatus('disabled'); return; }
    if (!isAuthenticated || !token) { setStatus('signed_out'); return; }
    if (theater.isLoaded) syncNow();
  }, [stateLoaded, enabled, baseUrl, isAuthenticated, token, theater.isLoaded, syncNow]);

  // Local edits: content soon, playback progress at most every 30s.
  useEffect(() => {
    if (!enabled || !theater.isLoaded || !stateRef.current) return;
    const dirty = collectDirty(theater.allFolders, stateRef.current.watermark || 0);
    if (dirty.contentDirty) schedule(SYNC_TIMING.contentDebounce);
    else if (dirty.progressDirty) schedule(SYNC_TIMING.progressThrottle);
  }, [theater.allFolders, theater.isLoaded, enabled, schedule]);

  // Periodic pull + pull on focus.
  useEffect(() => {
    if (!enabled) return undefined;
    const interval = setInterval(syncNow, SYNC_TIMING.pollInterval);
    const onFocus = () => {
      const last = stateRef.current?.lastSyncedAt || 0;
      if (Date.now() - last > SYNC_TIMING.focusMinGap) syncNow();
    };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [enabled, syncNow]);

  // Best-effort final push when the window goes away (§6.1 「關閉 app 前 push
  // 一次」). Fire-and-forget: the main process holds the request open past
  // renderer teardown (sync-client drains in-flight pushes on will-quit), and
  // the watermark is NOT advanced — if the push doesn't land, the same records
  // are simply pushed again on next launch (merge is idempotent).
  useEffect(() => {
    if (!enabled) return undefined;
    const flush = () => {
      const api = getElectronAPI();
      const state = stateRef.current;
      const baseUrl = normalizeBaseUrl(state?.baseUrl);
      const tok = currentToken();
      if (!api?.syncRequest || !baseUrl || !tok || !theaterRef.current.isLoaded) return;
      const dirty = collectDirty(theaterRef.current.allFolders, state.watermark || 0);
      const records = [...dirty.folders.map((r) => ['folders', r]), ...dirty.courses.map((r) => ['courses', r])]
        .slice(0, SYNC_TIMING.pushChunk); // one guaranteed-valid request; the rest syncs next launch
      if (!records.length) return;
      const body = { deviceId: state.deviceId, folders: [], courses: [] };
      for (const [kind, rec] of records) body[kind].push(rec);
      api.syncRequest({ baseUrl, method: 'POST', route: '/v1/sync', token: tok, body });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [enabled]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Settings: changing the server means a different dataset — start over.
  const setConfig = useCallback(({ enabled: nextEnabled, baseUrl: nextUrl }) => {
    const cur = stateRef.current || {};
    const url = nextUrl === undefined ? cur.baseUrl : (normalizeBaseUrl(nextUrl) || String(nextUrl).trim());
    const serverChanged = url !== cur.baseUrl;
    persist({
      ...cur,
      enabled: nextEnabled === undefined ? !!cur.enabled : !!nextEnabled,
      baseUrl: url || '',
      ...(serverChanged ? { cursor: 0, watermark: 0, orphans: [], userId: undefined } : {})
    });
    if (serverChanged) userIdRef.current = null;
  }, [persist]);

  return {
    status,
    error,
    enabled,
    baseUrl,
    configEnabled: !!syncState?.enabled,
    lastSyncedAt: syncState?.lastSyncedAt || null,
    clockSkewed,
    syncNow,
    setConfig
  };
}
