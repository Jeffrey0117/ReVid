// Serves the open library to other devices on the network, so a phone can
// watch what is on this computer without copying or uploading anything.
//
// This exposes files, so it is off until switched on, every request needs a
// token, and only paths inside the folder the user opened are reachable.
// The phone gets a small purpose-built page rather than the desktop UI —
// that UI is built around Electron APIs a browser does not have, and it is
// not usable on a touch screen anyway.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const library = require('./library-file.cjs');
const srt = require('./srt.cjs');

const VIDEO_MIME = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo'
};
const VIDEO_EXTS = Object.keys(VIDEO_MIME);

let server = null;
let token = null;
let servedRoot = null;   // only files under here are reachable
let boundPort = 0;

function makeToken() {
    return crypto.randomBytes(16).toString('base64url');
}

// Prefer a real LAN address over loopback or virtual adapters, so the URL
// shown to the user is one a phone can actually reach.
function lanAddress() {
    const candidates = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family !== 'IPv4' || a.internal) continue;
            const virtual = /vEthernet|VMware|VirtualBox|Loopback|WSL|Hyper-V/i.test(name);
            candidates.push({ address: a.address, virtual });
        }
    }
    const real = candidates.find(c => !c.virtual);
    return (real || candidates[0])?.address || '127.0.0.1';
}

// Every filesystem answer goes through this: resolve, then prove the result
// is still inside the folder the user opened.
function resolveInsideRoot(relOrAbs) {
    if (!servedRoot) return null;
    const target = path.resolve(servedRoot, relOrAbs);
    const root = path.resolve(servedRoot);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    return target;
}

function listLibrary() {
    if (!servedRoot) return [];
    let names;
    try { names = fs.readdirSync(servedRoot); } catch (e) { return []; }
    return names
        .filter(n => VIDEO_EXTS.includes(path.extname(n).toLowerCase()))
        .filter(n => !/\.revid-(tmp|bak)(\.[^.]+)?$/i.test(n))
        .filter(n => !/\.revid(\.tmp)?$/i.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((name) => {
            const full = path.join(servedRoot, name);
            const base = name.replace(/\.[^.]+$/, '');
            let size = 0;
            try { size = fs.statSync(full).size; } catch (e) { /* gone */ }
            const cues = library.getSubtitles(full);
            return {
                name,
                size,
                hasSubs: Boolean(cues?.length) || fs.existsSync(path.join(servedRoot, `${base}.srt`)),
                hasZh: Boolean(cues?.some(c => c.zh)) || fs.existsSync(path.join(servedRoot, `${base}.zh.srt`))
            };
        });
}

function sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
}

// Range support is what makes dragging the progress bar work; without it a
// phone has to download from the start every seek.
function streamVideo(req, res, filePath) {
    let stat;
    try { stat = fs.statSync(filePath); } catch (e) { res.writeHead(404); res.end(); return; }

    const type = VIDEO_MIME[path.extname(filePath).toLowerCase()] || 'video/mp4';
    const range = req.headers.range;
    const onError = (stream) => { stream.on('error', () => res.destroy()); return stream; };

    if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m && (m[1] || m[2])) {
            let start;
            let end;
            if (m[1]) {
                start = parseInt(m[1], 10);
                end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
            } else {
                start = stat.size - Math.min(parseInt(m[2], 10), stat.size);
                end = stat.size - 1;
            }
            if (Number.isNaN(start) || start >= stat.size || start > end) {
                res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
                res.end();
                return;
            }
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Content-Type': type
            });
            onError(fs.createReadStream(filePath, { start, end })).pipe(res);
            return;
        }
    }
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    onError(fs.createReadStream(filePath)).pipe(res);
}

function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const given = url.searchParams.get('k') || '';
    // Constant-time compare so the token can't be guessed a character at a time.
    const ok = token && given.length === token.length
        && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
    if (!ok) { res.writeHead(401, { 'Content-Type': 'text/plain' }); res.end('unauthorized'); return; }

    if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = require('./lan-page.cjs').render(token);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }

    if (url.pathname === '/api/library') {
        sendJson(res, 200, { files: listLibrary(), folder: path.basename(servedRoot || '') });
        return;
    }

    if (url.pathname === '/api/video' || url.pathname === '/api/subs') {
        const name = url.searchParams.get('name') || '';
        if (name.includes('/') || name.includes('\\')) { res.writeHead(400); res.end(); return; }
        const target = resolveInsideRoot(name);
        if (!target) { res.writeHead(403); res.end(); return; }

        if (url.pathname === '/api/video') { streamVideo(req, res, target); return; }

        const wantZh = url.searchParams.get('lang') === 'zh';
        // The folder library is the store; a sidecar may still exist if the
        // user brought their own subtitles.
        const cues = library.getSubtitles(target);
        if (cues?.length) {
            const body = srt.serialize(cues, wantZh ? 'zh' : 'text');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(body);
            return;
        }
        try {
            const base = target.replace(/\.[^.]+$/, '');
            const body = fs.readFileSync(base + (wantZh ? '.zh.srt' : '.srt'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(body);
        } catch (e) {
            res.writeHead(404); res.end();
        }
        return;
    }

    res.writeHead(404); res.end();
}

function start({ folder, port = 31848 }) {
    if (server) stop();
    if (!folder || !fs.existsSync(folder)) {
        return { success: false, error: 'No folder is open' };
    }
    servedRoot = folder;
    token = makeToken();

    return new Promise((resolve) => {
        server = http.createServer(handle);

        // The preferred port can be taken — by another app, or by a previous
        // share whose socket has not finished closing. Walk forward instead
        // of failing, the way the renderer server does.
        const tryListen = (p, attemptsLeft) => {
            const onError = (err) => {
                if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
                    server.removeListener('error', onError);
                    tryListen(p + 1, attemptsLeft - 1);
                    return;
                }
                server = null;
                token = null;
                servedRoot = null;
                resolve({ success: false, error: err.message });
            };
            server.once('error', onError);
            // 0.0.0.0 is the point — this is for other devices.
            server.listen(p, '0.0.0.0', () => {
                server.removeListener('error', onError);
                boundPort = server.address().port;
                resolve({
                    success: true,
                    url: `http://${lanAddress()}:${boundPort}/?k=${token}`,
                    port: boundPort,
                    folder
                });
            });
        };
        tryListen(port, 9);
    });
}

function stop() {
    if (server) { try { server.close(); } catch (e) { /* already down */ } }
    server = null;
    token = null;
    servedRoot = null;
    boundPort = 0;
    return { success: true };
}

function status() {
    return server
        ? { running: true, url: `http://${lanAddress()}:${boundPort}/?k=${token}`, folder: servedRoot }
        : { running: false };
}

module.exports = { start, stop, status };
