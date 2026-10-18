// Dev-only mock of the revid-sync backend. In-memory, no real auth:
//   Authorization: Bearer dev-<anything>   → userId "dev-<anything>"
// Run:  node dev/mock-sync-server/server.mjs   (PORT env, default 8787)
// Then set the sync server URL in ReVid to http://localhost:8787
import http from 'node:http';
import { createSyncStore } from './core.mjs';

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 5 * 1024 * 1024;
const store = createSyncStore();

const send = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Server-Time': String(Date.now()) });
  res.end(JSON.stringify(payload));
};
const fail = (res, status, code, error) => send(res, status, { success: false, code, error });

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  req.on('error', reject);
});

const userFrom = (req) => {
  const m = /^Bearer (dev-[\w-]{1,60})$/.exec(req.headers.authorization || '');
  return m ? m[1] : null;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return send(res, 200, { success: true, data: { version: '1.0.0-mock', time: Date.now() } });
    }
    const userId = userFrom(req);
    if (!userId) return fail(res, 401, 'UNAUTHORIZED', 'Missing or invalid authorization header');

    if (req.method === 'GET' && url.pathname === '/v1/me') {
      return send(res, 200, { success: true, data: { userId } });
    }
    if (req.method === 'GET' && url.pathname === '/v1/sync') {
      const since = Number(url.searchParams.get('since')) || 0;
      const limit = Number(url.searchParams.get('limit')) || 500;
      return send(res, 200, { success: true, ...store.pull(userId, since, limit) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/sync') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) {
        return e.code === 'TOO_LARGE' ? fail(res, 413, 'TOO_LARGE', 'Body too large') : fail(res, 400, 'BAD_REQUEST', 'Invalid JSON');
      }
      const result = store.push(userId, body);
      if (result.error) return fail(res, result.code === 'TOO_LARGE' ? 413 : 400, result.code, result.error);
      return send(res, 200, { success: true, ...result });
    }
    return fail(res, 404, 'NOT_FOUND', 'Not found');
  } catch {
    return fail(res, 500, 'SERVER_ERROR', 'Internal error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mock sync server on http://localhost:${PORT}\n`);
});
