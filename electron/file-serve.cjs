// Remotion renders inside Chromium, which will not read a local file path for
// video. One file, one unguessable path, loopback only, torn down when the
// render finishes — this never becomes a way into the filesystem.
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const TYPES = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

function contentType(filePath) {
    const dot = filePath.lastIndexOf('.');
    return TYPES[filePath.slice(dot).toLowerCase()] || 'application/octet-stream';
}

// Resolves to { url, close }. The url is only valid until close() is called.
function serveFile(filePath) {
    return new Promise((resolve, reject) => {
        let size;
        try { size = fs.statSync(filePath).size; } catch (e) {
            reject(new Error(`Cannot serve ${filePath}: ${e.message}`));
            return;
        }

        const token = crypto.randomBytes(16).toString('hex');
        const route = `/${token}`;
        const type = contentType(filePath);

        const server = http.createServer((req, res) => {
            // Compare on the path alone; a query string must not open a hole.
            const reqPath = (req.url || '').split('?')[0];
            if (reqPath !== route) {
                res.writeHead(404).end();
                return;
            }

            const range = req.headers.range;
            const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match) {
                res.writeHead(200, {
                    'Content-Type': type,
                    'Content-Length': size,
                    'Accept-Ranges': 'bytes'
                });
                if (req.method === 'HEAD') { res.end(); return; }
                fs.createReadStream(filePath).pipe(res);
                return;
            }

            const start = match[1] ? parseInt(match[1], 10) : 0;
            const end = match[2] ? parseInt(match[2], 10) : size - 1;
            if (!(start >= 0 && end < size && start <= end)) {
                res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
                return;
            }
            res.writeHead(206, {
                'Content-Type': type,
                'Content-Length': end - start + 1,
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes'
            });
            if (req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(filePath, { start, end }).pipe(res);
        });

        server.on('error', reject);
        // Port 0 so concurrent renders never collide; loopback so nothing
        // outside this machine can reach it.
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}${route}`,
                close: () => new Promise((done) => {
                    server.closeAllConnections?.();
                    server.close(() => done());
                })
            });
        });
    });
}

module.exports = { serveFile };
