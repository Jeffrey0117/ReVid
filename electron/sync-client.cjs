// Cloud-sync transport + local sync state (docs/SYNC-API.md §5–6).
// The renderer decides *what* to sync; this module only talks HTTP to the
// sync server and persists sync-state.json (deviceId, cursor, watermark…).
const { app, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REQUEST_TIMEOUT_MS = 15000;
const ALLOWED_ROUTES = [
    { method: 'GET', pattern: /^\/v1\/health$/ },
    { method: 'GET', pattern: /^\/v1\/me$/ },
    { method: 'GET', pattern: /^\/v1\/sync\?since=\d+(&limit=\d+)?$/ },
    { method: 'POST', pattern: /^\/v1\/sync$/ },
];

const getSyncStatePath = () => path.join(app.getPath('userData'), 'sync-state.json');

// Public servers must use HTTPS; plain HTTP only for a server on this machine.
function parseBaseUrl(raw) {
    try {
        const url = new URL(String(raw || '').trim());
        const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
        return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
        return null;
    }
}

const isAllowedRoute = (method, route) =>
    ALLOWED_ROUTES.some((r) => r.method === method && r.pattern.test(route));

async function syncRequest({ baseUrl, method, route, token, body }) {
    const base = parseBaseUrl(baseUrl);
    if (!base) return { success: false, code: 'BAD_CONFIG', error: 'Sync server URL must be https:// (or http://localhost)' };
    if (!isAllowedRoute(method, route)) return { success: false, code: 'BAD_REQUEST', error: 'Route not allowed' };

    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(base + route, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (e) {
        return { success: false, code: 'OFFLINE', error: e?.name === 'TimeoutError' ? 'Request timed out' : 'Cannot reach sync server' };
    }

    const serverTime = Number(res.headers.get('x-server-time')) || null;
    const retryAfter = Number(res.headers.get('retry-after')) || null;
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON error body */ }

    if (!res.ok || !json?.success) {
        return {
            success: false,
            status: res.status,
            code: json?.code || (res.status === 401 ? 'UNAUTHORIZED' : 'SERVER_ERROR'),
            error: json?.error || `HTTP ${res.status}`,
            retryAfter,
            serverTime,
        };
    }
    return { success: true, status: res.status, data: json.data, serverTime };
}

// --- sync-state.json ---

const STATE_FIELDS = {
    enabled: 'boolean',
    baseUrl: 'string',
    deviceId: 'string',
    userId: 'string',
    cursor: 'number',
    watermark: 'number',
    lastSyncedAt: 'number',
};

function sanitizeState(raw) {
    const state = {};
    for (const [key, type] of Object.entries(STATE_FIELDS)) {
        if (typeof raw?.[key] === type) state[key] = raw[key];
    }
    state.orphans = Array.isArray(raw?.orphans) ? raw.orphans.slice(0, 5000) : [];
    return state;
}

async function loadSyncState() {
    let raw = null;
    try {
        raw = JSON.parse(await fs.promises.readFile(getSyncStatePath(), 'utf-8'));
    } catch { /* first run or unreadable: start fresh */ }
    const state = sanitizeState(raw);
    if (!state.deviceId) {
        state.deviceId = `d_${crypto.randomUUID()}`;
        await saveSyncState(state);
    }
    return state;
}

let saveChain = Promise.resolve();
function saveSyncState(state) {
    const clean = sanitizeState(state);
    const target = getSyncStatePath();
    const tmp = `${target}.tmp`;
    saveChain = saveChain
        .then(async () => {
            await fs.promises.writeFile(tmp, JSON.stringify(clean), 'utf-8');
            await fs.promises.rename(tmp, target);
        })
        .catch((e) => console.error('[sync-state] save failed:', e?.message || e));
    return saveChain;
}

// In-flight requests, so will-quit can give the renderer's final pagehide push
// (§6.1) a chance to land before the process exits.
const inFlight = new Set();
const trackedSyncRequest = (req) => {
    const p = syncRequest(req);
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
    return p;
};
const drainSyncRequests = () => Promise.allSettled([...inFlight]);

function registerSyncClient() {
    ipcMain.handle('sync-request', (_event, req) => trackedSyncRequest(req || {}));
    ipcMain.handle('load-sync-state', async () => {
        try {
            return { success: true, state: await loadSyncState() };
        } catch (e) {
            return { success: false, error: e?.message || 'load failed' };
        }
    });
    ipcMain.handle('save-sync-state', async (_event, state) => {
        await saveSyncState(state);
        return { success: true };
    });
}

module.exports = { registerSyncClient, drainSyncRequests, parseBaseUrl, isAllowedRoute };
