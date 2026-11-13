// whisper.cpp ships prebuilt CLIs for Windows only — the macOS asset in the
// same release is an xcframework, which is a library to embed, not something
// that can be run. So the Mac build must say "install it yourself" instead of
// offering a download that cannot succeed, and must still pick up a CLI the
// user installed via Homebrew.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RUNNER = require.resolve('../../electron/whisper-runner.cjs');

// Platform and env stay set for the whole body, not just the require: the
// module reads both at call time, so restoring either early makes these tests
// pass for the wrong reason. (It cost one round of exactly that.)
function as(platform, env, fn) {
    const realPlatform = process.platform;
    const savedEnv = {};
    for (const [k, v] of Object.entries(env)) {
        savedEnv[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });

    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath,
        filename: electronPath,
        loaded: true,
        exports: {
            // A userData path that does not exist, so nothing but the override
            // and the system prefixes can satisfy binaryReady.
            app: { getPath: () => path.join(os.tmpdir(), 'revid-no-such-userdata') },
            net: { request: () => { throw new Error('no network in tests'); } }
        }
    };
    delete require.cache[RUNNER];

    try {
        return fn(require(RUNNER));
    } finally {
        Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
}

const NO_OVERRIDE = { REVID_WHISPER_CLI: undefined };

test('Windows reports that ReVid can install the engine itself', () => {
    as('win32', NO_OVERRIDE, (mod) => {
        const status = mod.getWhisperStatus();
        assert.equal(status.installable, true);
        assert.equal(status.platform, 'win32');
    });
});

// The flag the UI branches on. Getting this wrong means a Mac user taps a
// download button that can only ever fail.
test('macOS reports that it cannot', () => {
    as('darwin', NO_OVERRIDE, (mod) => {
        const status = mod.getWhisperStatus();
        assert.equal(status.installable, false);
        assert.equal(status.platform, 'darwin');
        assert.equal(status.binaryReady, false, 'no engine on a bare Mac');
    });
});

// Every field in one status object must describe the same platform. They used
// to disagree — installable was captured at module load, platform read at call
// time — which is the kind of split that makes a bug report unreproducible.
test('a status object does not contradict itself', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
        as(platform, NO_OVERRIDE, (mod) => {
            const status = mod.getWhisperStatus();
            assert.equal(status.platform, platform);
            assert.equal(status.installable, platform === 'win32', `installable on ${platform}`);
        });
    }
});

test('asking macOS to install the engine fails with something a person can act on', async () => {
    await as('darwin', NO_OVERRIDE, async (mod) => {
        await assert.rejects(
            () => mod.ensureWhisper({ flavor: 'cpu' }),
            (err) => {
                assert.match(err.message, /brew install whisper-cpp/, 'must name the fix');
                assert.match(err.message, /still play/i, 'must say watching still works');
                return true;
            }
        );
    });
});

test('a CLI the user installed elsewhere is picked up', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revid-whisper-'));
    const fake = path.join(dir, 'whisper-cli');
    fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fake, 0o755);
    try {
        as('darwin', { REVID_WHISPER_CLI: fake }, (mod) => {
            assert.equal(mod.findSystemWhisper(), fake);
            const status = mod.getWhisperStatus();
            assert.equal(status.binaryReady, true);
            assert.equal(status.flavor, 'system');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('an override pointing at nothing is ignored rather than trusted', () => {
    const absent = path.join(os.tmpdir(), 'revid-definitely-absent-cli');
    as('darwin', { REVID_WHISPER_CLI: absent }, (mod) => {
        assert.equal(mod.findSystemWhisper(), null);
        assert.equal(mod.getWhisperStatus().binaryReady, false);
    });
});

// The bundled engine is found by filename, and the filename differs by OS.
test('the bundled engine is looked for under the right filename per platform', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revid-bin-'));
    try {
        const posix = path.join(dir, 'whisper-cli');
        fs.writeFileSync(posix, '');
        as('darwin', NO_OVERRIDE, (mod) => {
            assert.equal(mod.findWhisperExe(dir), posix, 'posix: no .exe suffix');
        });
        as('win32', NO_OVERRIDE, (mod) => {
            assert.equal(mod.findWhisperExe(dir), null, 'win32 must not accept a suffixless file');
        });

        const exe = path.join(dir, 'whisper-cli.exe');
        fs.writeFileSync(exe, '');
        as('win32', NO_OVERRIDE, (mod) => {
            assert.equal(mod.findWhisperExe(dir), exe, 'win32: .exe');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
