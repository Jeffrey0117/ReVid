// Drives the Remotion render server that AutoReel and plottr already share.
// ReVid does not own the look of a finished short — that composition lives in
// the remotion project, and this just feeds it and reports back.
//
// The server speaks one JSON object per stdout line:
//   out {"type":"ready"}
//   in  {"type":"render","id","propsPath","output"}
//   out {"type":"progress","id","percent"} ... {"type":"done","id","ok"}
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SERVER_ENTRY = 'render-server.mjs';

// The compositor is a sibling project, not a dependency. Look where this
// user keeps them before giving up and asking.
function candidateDirs() {
    const home = os.homedir();
    const fromEnv = process.env.REVID_REMOTION_DIR;
    const roots = ['AutoReel', 'plottr', 'reel-factory'];
    return [
        ...(fromEnv ? [fromEnv] : []),
        ...roots.map(r => path.join(home, 'code', r, 'remotion'))
    ];
}

function findRemotionDir() {
    for (const dir of candidateDirs()) {
        if (fs.existsSync(path.join(dir, SERVER_ENTRY))) return dir;
    }
    return null;
}

// Prefer a real node: that is what the remotion project is developed against.
// Electron can stand in through ELECTRON_RUN_AS_NODE when none is installed.
function nodeCommand() {
    // No shell: it would concatenate rather than escape, and PATH lookup
    // already happens without one.
    const probe = spawnSync('node', ['--version'], { encoding: 'utf8', windowsHide: true });
    if (!probe.error && probe.status === 0) return { cmd: 'node', env: {} };
    return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function createRemotionRunner() {
    let child = null;
    let ready = null;            // Promise resolved once the server says ready
    const jobs = new Map();      // id -> { resolve, reject, onProgress }
    let seq = 0;

    const dispose = () => {
        for (const job of jobs.values()) {
            job.reject(new Error('Render server stopped'));
        }
        jobs.clear();
        child = null;
        ready = null;
    };

    function start() {
        if (ready) return ready;

        const dir = findRemotionDir();
        if (!dir) {
            return Promise.reject(new Error(
                'Remotion project not found. Set REVID_REMOTION_DIR to the ' +
                'folder holding render-server.mjs.'
            ));
        }
        if (!fs.existsSync(path.join(dir, 'node_modules'))) {
            return Promise.reject(new Error(
                `Remotion dependencies are not installed. Run npm install in ${dir}.`
            ));
        }

        const { cmd, env } = nodeCommand();
        ready = new Promise((resolve, reject) => {
            let settled = false;
            child = spawn(cmd, [SERVER_ENTRY], {
                cwd: dir,
                env: { ...process.env, ...env },
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Bundling webpack on a cold start is slow but not unbounded;
            // without a cap a broken install would hang the export forever.
            const bootTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('Render server did not start within 3 minutes'));
                stop();
            }, 180000);

            let out = '';
            child.stdout.on('data', (chunk) => {
                out += chunk.toString();
                const lines = out.split('\n');
                out = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let msg;
                    try { msg = JSON.parse(line); } catch (e) { continue; }

                    if (msg.type === 'ready' && !settled) {
                        settled = true;
                        clearTimeout(bootTimer);
                        resolve();
                        continue;
                    }
                    const job = jobs.get(msg.id);
                    if (!job) continue;
                    if (msg.type === 'progress') {
                        job.onProgress?.(Math.max(0, Math.min(100, msg.percent || 0)));
                    } else if (msg.type === 'done') {
                        jobs.delete(msg.id);
                        if (msg.ok) job.resolve();
                        else job.reject(new Error(msg.error || 'Render failed'));
                    }
                }
            });

            // The server logs to stderr; keep the tail for failure reports.
            let errTail = '';
            child.stderr.on('data', (d) => {
                errTail = (errTail + d.toString()).slice(-2000);
            });

            child.on('error', (e) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(bootTimer);
                    reject(new Error(`Could not start the render server: ${e.message}`));
                }
                dispose();
            });

            child.on('exit', (code) => {
                clearTimeout(bootTimer);
                if (!settled) {
                    settled = true;
                    reject(new Error(
                        `Render server exited (${code}). ${errTail.trim().slice(-400)}`
                    ));
                }
                dispose();
            });
        });

        return ready.catch((e) => { ready = null; throw e; });
    }

    async function render({ propsPath, output, composition }, onProgress) {
        await start();
        const id = `revid-${++seq}`;
        return new Promise((resolve, reject) => {
            jobs.set(id, { resolve, reject, onProgress });
            const job = { type: 'render', id, propsPath, output };
            if (composition) job.composition = composition;
            child.stdin.write(`${JSON.stringify(job)}\n`);
        });
    }

    function stop() {
        if (!child) return;
        const proc = child;
        dispose();
        try { proc.stdin.end(); } catch (e) { /* already gone */ }
        // Give it a moment to close Chromium cleanly before forcing it.
        setTimeout(() => { try { proc.kill(); } catch (e) { /* gone */ } }, 2000);
    }

    return { render, stop, isAvailable: () => Boolean(findRemotionDir()) };
}

module.exports = { createRemotionRunner, findRemotionDir };
