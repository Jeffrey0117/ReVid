// Takes a URL from the browser extension and hands it to ReVid.
//
// Deliberately NOT part of the LAN share. That one exists to let other devices
// read files and is bound to the network; this is a command channel that makes
// this machine do something, so it listens on the loopback address only — a
// phone on the same wifi cannot reach it, and neither can anything else.
//
// A page you visit can still POST to 127.0.0.1 from your own browser, so the
// token is not decoration: without it, any site could queue downloads on your
// machine. It is generated once, kept beside ReVid's other data, and pasted
// into the extension by hand.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 31849;
const MAX_BODY = 8 * 1024;        // a URL, not an upload

let server = null;
let token = null;
let statePath = null;
let onGrab = null;

function setStatePath(dir) {
    statePath = path.join(dir, 'grab.json');
}

function readToken() {
    try {
        const saved = JSON.parse(fs.readFileSync(statePath, 'utf8')).token;
        if (typeof saved === 'string' && saved.length >= 16) return saved;
    } catch (e) { /* first run */ }
    return null;
}

// Stable across restarts: the extension holds a copy, and regenerating it on
// every launch would mean pasting it in again every launch.
function stableToken() {
    const saved = readToken();
    if (saved) return saved;
    const fresh = crypto.randomBytes(16).toString('base64url');
    try { fs.writeFileSync(statePath, JSON.stringify({ token: fresh }), 'utf8'); } catch (e) { /* ram only */ }
    return fresh;
}

function rotateToken() {
    try { fs.writeFileSync(statePath, JSON.stringify({ token: crypto.randomBytes(16).toString('base64url') }), 'utf8'); } catch (e) { /* ram only */ }
    token = readToken() || token;
    return token;
}

function sameToken(given) {
    if (typeof given !== 'string' || !token) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    // Compare in constant time, and only when the lengths already match —
    // timingSafeEqual throws on a length mismatch, which would itself leak.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function handle(req, res) {
    // The extension sends JSON, which makes this a preflighted request.
    const origin = req.headers.origin || '';
    const allowed = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');

    if (req.method === 'OPTIONS') {
        res.writeHead(allowed ? 204 : 403, allowed ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600'
        } : {});
        res.end();
        return;
    }

    const cors = allowed ? { 'Access-Control-Allow-Origin': origin } : {};

    if (req.method !== 'POST' || req.url.split('?')[0] !== '/api/grab') {
        res.writeHead(404, cors); res.end(); return;
    }

    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
        if (tooBig) return;
        body += chunk;
        if (body.length > MAX_BODY) { tooBig = true; res.writeHead(413, cors); res.end(); req.destroy(); }
    });
    req.on('end', () => {
        if (tooBig) return;
        let payload;
        try { payload = JSON.parse(body); } catch (e) { res.writeHead(400, cors); res.end(); return; }

        if (!sameToken(payload.token)) {
            res.writeHead(401, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad token' }));
            return;
        }
        const url = typeof payload.url === 'string' ? payload.url.trim() : '';
        if (!/^https?:\/\//i.test(url)) {
            res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'only http(s) urls' }));
            return;
        }

        // Handing it on does not mean downloading it yet: the app asks where
        // to put it. A browser click should not be able to write a file
        // somewhere without the user seeing the question.
        try { onGrab?.(url); } catch (e) { /* the app will log its own */ }
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });
}

function start(handler) {
    onGrab = handler;
    token = stableToken();
    if (server) return Promise.resolve({ success: true, port: PORT, token });
    return new Promise((resolve) => {
        server = http.createServer(handle);
        server.on('error', (err) => {
            server = null;
            resolve({ success: false, error: err.message });
        });
        // 127.0.0.1 explicitly, not 0.0.0.0: binding this to the network
        // would put a "download whatever I say" button on the wifi.
        server.listen(PORT, '127.0.0.1', () => resolve({ success: true, port: PORT, token }));
    });
}

function stop() {
    if (!server) return { success: true };
    try { server.close(); } catch (e) { /* already going */ }
    server = null;
    return { success: true };
}

function status() {
    return server ? { running: true, port: PORT, token } : { running: false, token };
}

module.exports = { start, stop, status, setStatePath, rotateToken, PORT };
