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
