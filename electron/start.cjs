const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron');

const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, '..')], {
    stdio: 'inherit',
    env: cleanEnv
});

child.on('close', (code) => {
    process.exit(code);
});
