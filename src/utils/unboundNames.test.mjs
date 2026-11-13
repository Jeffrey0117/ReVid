import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    unboundComponents, boundNames, jsxComponents,
    unboundValues, usedValueNames, stripNoise
} from './unboundNames.js';

test('an icon used but never imported is reported', () => {
    const src = `
import { useState } from 'react';
export const Bar = () => <div><GraduationCap size={14} /></div>;
`;
    assert.deepEqual(unboundComponents(src), ['GraduationCap']);
});

test('an imported one is not', () => {
    const src = `
import { GraduationCap, Tv } from './icons';
export const Bar = () => <><GraduationCap /><Tv /></>;
`;
    assert.deepEqual(unboundComponents(src), []);
});

test('renamed and default imports both count as bound', () => {
    const src = `
import Plyr from 'plyr';
import { Search as SearchIcon } from './icons';
export const Bar = () => <><SearchIcon /><Plyr /></>;
`;
    assert.deepEqual(unboundComponents(src), []);
});

test('a component defined in the same file counts as bound', () => {
    const src = `
function Row() { return <li />; }
const Card = () => <div />;
export const List = () => <ul><Row /><Card /></ul>;
`;
    assert.deepEqual(unboundComponents(src), []);
});

test('multi-line import blocks are read whole', () => {
    const src = `
import {
    Search as SearchIcon, Tv, GraduationCap,
    ArrowLeft, ArrowRight, ArrowUp
} from './components/icons';
export const Bar = () => <><ArrowUp /><GraduationCap /><Tv /></>;
`;
    assert.deepEqual(unboundComponents(src), []);
});

// A component renamed out of a destructured parameter is bound, and a
// checker that says otherwise is noise people learn to ignore.
test('a component destructured from a parameter counts as bound', () => {
    const src = `
import { ArrowLeft } from './icons';
const Bar = () => items.map(({ key, Icon: Arrow, on }) => <Arrow key={key} />);
`;
    assert.deepEqual(unboundComponents(src), []);
});

test('a destructured function parameter counts too', () => {
    const src = 'function Row({ Cell }) { return <Cell />; }';
    assert.deepEqual(unboundComponents(src), []);
});

test('lowercase tags are left alone', () => {
    assert.deepEqual(unboundComponents('const A = () => <div><span /></div>;'), []);
});

test('the pieces work on their own', () => {
    assert.ok(jsxComponents('<Foo /><bar /><Baz.Qux />').has('Foo'));
    assert.ok(boundNames("import { A } from 'x'; const B = 1;").has('A'));
    assert.ok(boundNames("const { C, D: E } = require('y');").has('E'));
});

// --- main process: the same mistake, without JSX to spot it by ---

// This is the exact edit that prompted the check: `Menu` was dropped from the
// destructured require while a call to it stayed behind in createWindow().
// esbuild does not bundle electron/, so nothing would have complained until
// the window opened.
test('an electron class used after being dropped from the require is reported', () => {
    const src = `
const { app, BrowserWindow } = require('electron');
function createWindow() {
    Menu.setApplicationMenu(null);
    return new BrowserWindow({});
}
`;
    assert.deepEqual(unboundValues(src), ['Menu']);
});

test('the same file with Menu required is clean', () => {
    const src = `
const { app, BrowserWindow, Menu } = require('electron');
function createWindow() { Menu.setApplicationMenu(null); }
`;
    assert.deepEqual(unboundValues(src), []);
});

test('a module required on its own line counts as bound', () => {
    const src = "const Store = require('./store.cjs'); Store.save();";
    assert.deepEqual(unboundValues(src), []);
});

// Prose is not code. A comment naming a thing must not read as a use of it.
test('a name mentioned only in a comment is not a use', () => {
    const src = `
// Squirrel.Mac refuses to apply an unsigned update.
/* See Foo.bar for why. */
const x = 1;
`;
    assert.deepEqual(unboundValues(src), []);
});

test('a name inside a string is not a use', () => {
    const src = "const msg = 'call Menu.setApplicationMenu(null) to clear it';";
    assert.deepEqual(unboundValues(src), []);
});

test('a template literal body is not a use', () => {
    const src = 'const u = `https://x/${id}/Thing.zip`;';
    assert.deepEqual(unboundValues(src), []);
});

test('a regex literal does not swallow the rest of the file', () => {
    const src = `
const { Menu } = require('electron');
const isCjs = /\\.cjs$/;
Menu.setApplicationMenu(null);
`;
    assert.deepEqual(unboundValues(src), []);
    assert.ok(stripNoise(src).includes('Menu.setApplicationMenu'));
});

test('division is not mistaken for a regex', () => {
    const src = 'const pct = (got) / (total) / 2; const n = 1;';
    assert.equal(stripNoise(src).replace(/\s+/g, ' ').trim(), 'const pct = (got) / (total) / 2; const n = 1;');
});

test('node globals and built-ins are not reported', () => {
    const src = 'Buffer.from("x"); JSON.parse("{}"); new Set(); Math.max(1);';
    assert.deepEqual(unboundValues(src), []);
});

// A capitalised method on an imported object is not a name of its own: in
// OpenCC.Converter(…) only OpenCC has to be in scope. Both of these were
// false positives the first time this check ran against electron/.
test('a capitalised method on an imported object is not reported', () => {
    const src = "const OpenCC = require('opencc-js'); const f = OpenCC.Converter({ from: 'tw' });";
    assert.deepEqual(unboundValues(src), []);
});

test('typed arrays are not reported', () => {
    assert.deepEqual(unboundValues('const a = new Float64Array(8); const b = new Uint8Array(2);'), []);
});

test('the used-name finder sees both call and member shapes', () => {
    const used = usedValueNames('Menu.x(); Thing(); new Other();');
    assert.ok(used.has('Menu') && used.has('Thing') && used.has('Other'));
});

// The point of all this: the real source tree, every time tests run.
test('no component in this codebase is used without being imported', () => {
    const root = path.resolve('src');
    const offenders = [];

    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/\.jsx$/.test(entry.name)) continue;
            const unbound = unboundComponents(fs.readFileSync(full, 'utf8'));
            if (unbound.length) offenders.push(`${path.relative(root, full)}: ${unbound.join(', ')}`);
        }
    };
    walk(root);

    assert.deepEqual(offenders, [], `\n${offenders.join('\n')}`);
});

test('no main-process module uses a capitalised name it never brought in', () => {
    const root = path.resolve('electron');
    const offenders = [];

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.cjs$/.test(entry.name)) continue;
        const unbound = unboundValues(fs.readFileSync(path.join(root, entry.name), 'utf8'));
        if (unbound.length) offenders.push(`${entry.name}: ${unbound.join(', ')}`);
    }

    assert.deepEqual(offenders, [], `\n${offenders.join('\n')}`);
});
