// Catches the one mistake this codebase keeps making: using a component or
// icon in JSX without importing it. The bundler does not complain — esbuild
// treats an unknown identifier as a global — so it builds, ships, and throws
// the moment that view renders. It has cost three bugs already.

// Names that are legitimately global or built in.
const ALLOWED = new Set([
    'Fragment', 'React', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
    'Boolean', 'Date', 'Promise', 'Set', 'Map', 'Error', 'Image', 'Infinity',
    'NaN', 'Intl', 'RegExp', 'URL', 'Blob', 'FileReader', 'AbortController'
]);

// Globals the main process gets for free from Node.
const NODE_GLOBALS = new Set([
    'Buffer', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'AbortSignal',
    'WebSocket', 'Response', 'Request', 'Headers', 'Proxy', 'Reflect', 'Symbol',
    'BigInt', 'WeakMap', 'WeakSet', 'ArrayBuffer', 'DataView',
    'Function', 'TypeError', 'RangeError', 'SyntaxError', 'AggregateError',
    'Atomics', 'Event', 'EventTarget', 'MessageChannel',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
    'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
    'BigInt64Array', 'BigUint64Array', 'SharedArrayBuffer'
]);

// Blank out comments and string/template bodies so prose cannot look like code.
// Without this, a comment mentioning `Squirrel.Mac` reads as a use of an
// unbound `Squirrel`. Runs as a small state machine rather than regexes
// because a regex literal like /\.cjs$/ and a `//` comment are easy to
// confuse from the outside.
export function stripNoise(source) {
    const out = [];
    let i = 0;
    const n = source.length;
    // Tracks whether a `/` starts a regex or is division: after a value it is
    // division, after an operator or `(` it starts a regex.
    let prevMeaningful = '';
    while (i < n) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < n && source[i] !== '\n') { out.push(' '); i += 1; }
            continue;
        }
        if (c === '/' && next === '*') {
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
                out.push(source[i] === '\n' ? '\n' : ' ');
                i += 1;
            }
            out.push(' ', ' ');
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            out.push(c);
            i += 1;
            while (i < n && source[i] !== c) {
                if (source[i] === '\\') { out.push(' '); i += 1; }
                out.push(source[i] === '\n' ? '\n' : ' ');
                i += 1;
            }
            out.push(c);
            i += 1;
            prevMeaningful = c;
            continue;
        }
        if (c === '/' && !/[\w$)\]]/.test(prevMeaningful)) {
            // Regex literal: skip to the unescaped closing slash.
            out.push(' ');
            i += 1;
            while (i < n && source[i] !== '/') {
                if (source[i] === '\\') { out.push(' '); i += 1; }
                if (source[i] === '\n') break;          // unterminated — bail out
                out.push(' ');
                i += 1;
            }
            out.push(' ');
            i += 1;
            prevMeaningful = '/';
            continue;
        }
        out.push(c);
        if (!/\s/.test(c)) prevMeaningful = c;
        i += 1;
    }
    return out.join('');
}

// Capitalised identifiers used as a value: `Menu.setApplicationMenu(…)`,
// `new BrowserWindow(…)`, `Notification(…)`. These are the shape every Electron
// class takes, which is exactly what gets dropped from a destructured
// `require('electron')` when an import list is edited.
export function usedValueNames(source) {
    const used = new Set();
    const clean = stripNoise(source);
    // The lookbehind keeps this to the *root* of a chain: in `OpenCC.Converter(…)`
    // the name that has to be in scope is OpenCC, not Converter. Without it,
    // every capitalised method on an imported object reads as unbound.
    for (const m of clean.matchAll(/(?<![.\w$])([A-Z][A-Za-z0-9_$]*)\s*[.(]/g)) used.add(m[1]);
    for (const m of clean.matchAll(/(?<![.\w$])new\s+([A-Z][A-Za-z0-9_$]*)/g)) used.add(m[1]);
    return used;
}

// Capitalised names used as values that nothing in the file defines, requires
// or imports. Aimed at the main process, where nothing else checks: Vite does
// not bundle electron/, and there is no typecheck.
export function unboundValues(source) {
    const bound = boundNames(stripNoise(source));
    return [...usedValueNames(source)]
        .filter((name) => !bound.has(name) && !ALLOWED.has(name) && !NODE_GLOBALS.has(name))
        .sort();
}

// Every capitalised JSX tag used in the source: <Foo ...>, <Foo/>, <Foo.Bar>.
export function jsxComponents(source) {
    const used = new Set();
    for (const m of source.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) used.add(m[1]);
    return used;
}

// Names the file brings into scope, by any route it actually uses.
export function boundNames(source) {
    const bound = new Set();

    // import X, { a as b, c } from '...'
    for (const m of source.matchAll(/import\s+([^'"]+?)\s+from\s*['"]/g)) {
        const clause = m[1];
        const named = /\{([\s\S]*?)\}/.exec(clause);
        if (named) {
            for (const part of named[1].split(',')) {
                const name = part.trim().split(/\s+as\s+/).pop().trim();
                if (name) bound.add(name);
            }
        }
        const defaultName = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, ' ').trim();
        if (defaultName && /^[A-Za-z_$][\w$]*$/.test(defaultName)) bound.add(defaultName);
    }

    // const X = ..., function X(), class X
    for (const m of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) bound.add(m[1]);
    for (const m of source.matchAll(/(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
    const addGroup = (body) => {
        for (const part of body.split(',')) {
            // `a`, `a: b`, `a = 1` — the bound name is the last identifier
            // before any default.
            const name = part.trim().split(':').pop().trim().split('=')[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
        }
    };

    // const { a, b } = ... destructuring, including from require()
    for (const m of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) addGroup(m[1]);

    // Destructured parameters: ({ Icon: Arrow }) => … and function f({ a }).
    // Without these, a component renamed out of a parameter looks unimported.
    for (const m of source.matchAll(/\(\s*\{([^}]*)\}\s*\)\s*(?:=>|\{)/g)) addGroup(m[1]);

    return bound;
}

// Components used in JSX that nothing in the file defines or imports.
export function unboundComponents(source) {
    const bound = boundNames(source);
    return [...jsxComponents(source)]
        .filter(name => !bound.has(name) && !ALLOWED.has(name) && !name.includes('.'))
        .sort();
}
