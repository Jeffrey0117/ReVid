// Runs user-installed plugins in the renderer and hands each one a capability
// object built strictly from the permissions its manifest declares.
//
// A plugin is CommonJS-shaped source evaluated in a function scope:
//   module.exports = { activate(api) {...}, deactivate() {...} }
//
// These are local folders the user chose to install, so the goal is not to
// sandbox hostile code — it is to give plugins a stable, narrow surface so
// they keep working as ReVid changes, and so a broken one can't take the
// player down with it.

const getElectronAPI = () => window.electronAPI || null;

// --- audio ----------------------------------------------------------------
// The player owns the Web Audio graph. It registers a slot here; audio
// plugins splice themselves into it. The slot is a fixed input/output pair so
// the player can rebuild its own chain without plugins noticing.
const audioHost = {
    slot: null,       // { context, input, output } | null
    occupant: null,   // plugin id currently routed through the slot
    ensure: null,     // player-provided: build the graph on demand
    listeners: new Set()
};

export function setAudioSlot(slot) {
    audioHost.slot = slot;
    for (const fn of audioHost.listeners) {
        try { fn(slot); } catch (e) { console.error('[plugin] audio listener failed', e); }
    }
}

// The player builds its Web Audio graph lazily (an AudioContext created before
// any user gesture can stay suspended and silence playback). A plugin that
// needs the graph asks for it through this.
export function setAudioSlotProvider(fn) {
    audioHost.ensure = fn;
}

export function getAudioSlot() {
    return audioHost.slot;
}

// --- player ---------------------------------------------------------------
let playerBridge = null;

export function setPlayerBridge(bridge) {
    playerBridge = bridge;
}

// --- UI panels ------------------------------------------------------------
// Plugins render into a plain DOM element, so they need no React and no
// knowledge of ReVid's component tree.
const panelHost = {
    panels: new Map(), // id -> { id, pluginId, title, icon, mount, unmount }
    listeners: new Set()
};

function notifyPanels() {
    const list = [...panelHost.panels.values()];
    for (const fn of panelHost.listeners) {
        try { fn(list); } catch (e) { console.error('[plugin] panel listener failed', e); }
    }
}

export function subscribePanels(fn) {
    panelHost.listeners.add(fn);
    fn([...panelHost.panels.values()]);
    return () => panelHost.listeners.delete(fn);
}

// --- api construction -----------------------------------------------------
function makeApi(manifest, disposers) {
    const has = (perm) => manifest.permissions.includes(perm);
    const api = {
        id: manifest.id,
        manifest: { ...manifest, source: undefined },
        log: (...args) => console.log(`[plugin:${manifest.id}]`, ...args)
    };

    if (has('storage')) {
        const prefix = `revid-plugin:${manifest.id}:`;
        api.storage = {
            get(key, fallback = null) {
                try {
                    const raw = localStorage.getItem(prefix + key);
                    return raw == null ? fallback : JSON.parse(raw);
                } catch (e) {
                    return fallback;
                }
            },
            set(key, value) {
                try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (e) { /* full */ }
            },
            remove(key) {
                try { localStorage.removeItem(prefix + key); } catch (e) { /* ignore */ }
            }
        };
    }

    if (has('audio')) {
        api.audio = {
            // Current slot, or null if the player hasn't built its graph yet
            // (it is created lazily on the first audio-affecting action).
            getSlot: () => audioHost.slot,
            // Build the graph now if it doesn't exist yet. Call this from a
            // user gesture so the AudioContext starts running, not suspended.
            ensureSlot() {
                if (!audioHost.slot) {
                    try { audioHost.ensure?.(); } catch (e) { api.log('ensureSlot failed', e); }
                }
                return audioHost.slot;
            },
            // Called immediately if a slot already exists, and again whenever
            // the player rebuilds it.
            onSlot(fn) {
                audioHost.listeners.add(fn);
                if (audioHost.slot) {
                    try { fn(audioHost.slot); } catch (e) { api.log('onSlot failed', e); }
                }
                const off = () => audioHost.listeners.delete(fn);
                disposers.push(off);
                return off;
            },
            claim() {
                if (audioHost.occupant && audioHost.occupant !== manifest.id) return false;
                audioHost.occupant = manifest.id;
                disposers.push(() => {
                    if (audioHost.occupant === manifest.id) audioHost.occupant = null;
                });
                return true;
            },
            isClaimedByOther: () => Boolean(audioHost.occupant) && audioHost.occupant !== manifest.id
        };
    }

    if (has('player')) {
        api.player = {
            play: () => playerBridge?.play(),
            pause: () => playerBridge?.pause(),
            seek: (t) => playerBridge?.seek(t),
            getCurrentTime: () => playerBridge?.getCurrentTime() ?? 0,
            getDuration: () => playerBridge?.getDuration() ?? 0,
            isPaused: () => playerBridge?.isPaused() ?? true
        };
    }

    if (has('subtitles')) {
        api.subtitles = {
            getCues: () => playerBridge?.getCues() ?? [],
            getActiveCue: () => playerBridge?.getActiveCue() ?? null
        };
    }

    if (has('ui')) {
        api.ui = {
            // mount(el) renders into a plugin-owned DOM node; unmount() tears
            // it down. ReVid only decides where and when the node is shown.
            registerPanel({ title, icon, mount, unmount }) {
                const id = `${manifest.id}:panel`;
                panelHost.panels.set(id, {
                    id,
                    pluginId: manifest.id,
                    title: title || manifest.name,
                    icon: icon || null,
                    mount,
                    unmount
                });
                notifyPanels();
                const off = () => {
                    panelHost.panels.delete(id);
                    notifyPanels();
                };
                disposers.push(off);
                return off;
            }
        };
    }

    return api;
}

// --- lifecycle ------------------------------------------------------------
const active = new Map(); // id -> { manifest, instance, disposers }

function evaluatePlugin(source, manifest) {
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func
    const fn = new Function('module', 'exports', 'console', `"use strict";\n${source}\n`);
    fn(module, module.exports, {
        log: (...a) => console.log(`[plugin:${manifest.id}]`, ...a),
        warn: (...a) => console.warn(`[plugin:${manifest.id}]`, ...a),
        error: (...a) => console.error(`[plugin:${manifest.id}]`, ...a)
    });
    return module.exports;
}

export function deactivatePlugin(id) {
    const entry = active.get(id);
    if (!entry) return;
    try { entry.instance.deactivate?.(); } catch (e) { console.error(`[plugin:${id}] deactivate failed`, e); }
    for (const dispose of entry.disposers.reverse()) {
        try { dispose(); } catch (e) { console.error(`[plugin:${id}] dispose failed`, e); }
    }
    active.delete(id);
}

export function activatePlugin(manifest) {
    if (active.has(manifest.id)) return { success: true, alreadyActive: true };
    if (!manifest.source) return { success: false, error: 'No source' };

    const disposers = [];
    try {
        const instance = evaluatePlugin(manifest.source, manifest);
        if (typeof instance.activate !== 'function') {
            return { success: false, error: 'Plugin does not export activate()' };
        }
        const api = makeApi(manifest, disposers);
        instance.activate(api);
        active.set(manifest.id, { manifest, instance, disposers });
        return { success: true };
    } catch (e) {
        // A plugin that throws must not take the player with it.
        for (const dispose of disposers.reverse()) {
            try { dispose(); } catch (e2) { /* best effort */ }
        }
        console.error(`[plugin:${manifest.id}] activate failed`, e);
        return { success: false, error: e.message };
    }
}

export function getActivePluginIds() {
    return [...active.keys()];
}

// Load every enabled plugin, replacing whatever is currently active.
export async function reloadPlugins() {
    const api = getElectronAPI();
    if (!api?.pluginsList) return { success: false, error: 'Plugins unavailable', plugins: [] };

    for (const id of getActivePluginIds()) deactivatePlugin(id);

    const result = await api.pluginsList();
    if (!result.success) return { ...result, plugins: [] };

    const plugins = result.plugins.map((p) => {
        if (p.broken || !p.enabled) return { ...p, activated: false };
        const r = activatePlugin(p);
        return { ...p, activated: r.success, error: r.success ? p.error : r.error };
    });
    return { success: true, plugins, dir: result.dir };
}
