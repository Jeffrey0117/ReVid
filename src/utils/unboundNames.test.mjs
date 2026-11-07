import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unboundComponents, boundNames, jsxComponents } from './unboundNames.js';

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
