const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron');

const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

// REVID_DEBUG_PORT=9222 opens the DevTools protocol so a renderer-only
// behaviour (a media event that may or may not be firing, a listener that may
// or may not be attached) can be driven and observed directly, instead of
// guessed at from the outside.
const extra = process.env.REVID_DEBUG_PORT
    ? [`--remote-debugging-port=${process.env.REVID_DEBUG_PORT}`]
    : [];

const child = spawn(electronPath, [path.join(__dirname, '..'), ...extra], {
    stdio: 'inherit',
    env: cleanEnv
});

child.on('close', (code) => {
    process.exit(code);
});
