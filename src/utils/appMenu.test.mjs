// The menu is removed on Windows and Linux, but on macOS removing it takes
// Cmd+Q, Cmd+W and every Cmd+C/V/A with it — the shortcuts there are driven by
// menu items. These tests pin both halves of that branch, and they load the
// real module (with electron stubbed) so a broken require path is caught too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Seed require.cache so the module under test gets a stub instead of the real
// electron, which cannot run outside an Electron process.
function loadWithStub() {
    const calls = [];
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath,
        filename: electronPath,
        loaded: true,
        exports: {
            Menu: {
                setApplicationMenu: (m) => calls.push(m),
                buildFromTemplate: (template) => ({ template })
            }
        }
    };
    const modPath = require.resolve('../../electron/app-menu.cjs');
    delete require.cache[modPath];
    const mod = require(modPath);
    return { mod, calls };
}

test('the module loads with its require path intact', () => {
    const { mod } = loadWithStub();
    assert.equal(typeof mod.applyAppMenu, 'function');
    assert.equal(typeof mod.buildMacTemplate, 'function');
});

test('Windows gets no menu at all', () => {
    const { mod, calls } = loadWithStub();
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
        mod.applyAppMenu();
    } finally {
        Object.defineProperty(process, 'platform', { value: real, configurable: true });
    }
    assert.deepEqual(calls, [null], 'win32 should clear the menu bar');
});

test('macOS gets a real menu instead of null', () => {
    const { mod, calls } = loadWithStub();
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
        mod.applyAppMenu();
    } finally {
        Object.defineProperty(process, 'platform', { value: real, configurable: true });
    }
    assert.equal(calls.length, 1);
    assert.notEqual(calls[0], null, 'darwin must not clear the menu — it owns the shortcuts');
    assert.ok(Array.isArray(calls[0].template));
});

// The roles below are what actually carry Cmd+Q and clipboard editing. Naming
// them in a test means a future tidy-up cannot quietly drop one.
test('the macOS template keeps the roles the shortcuts come from', () => {
    const { mod } = loadWithStub();
    const roles = mod.buildMacTemplate().map((item) => item.role).filter(Boolean);
    for (const needed of ['appMenu', 'editMenu', 'windowMenu']) {
        assert.ok(roles.includes(needed), `missing ${needed} — loses its shortcuts`);
    }
});

test('the macOS template has no single-key accelerators to steal from the player', () => {
    const { mod } = loadWithStub();
    const walk = (items) => items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? walk(i.submenu) : [])]);
    for (const item of walk(mod.buildMacTemplate())) {
        if (!item.accelerator) continue;
        assert.ok(
            /Cmd|Command|Ctrl|Alt|Shift/i.test(item.accelerator),
            `${item.accelerator} would swallow a player key`
        );
    }
});
