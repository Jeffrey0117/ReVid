// Plugin discovery for ReVid. Plugins are plain folders under
// userData/plugins/<id>/ holding a manifest and one JS entry file:
//
//   plugin.json  { id, name, version, description, author, entry, permissions }
//   index.js     module.exports = { activate(api), deactivate() }
//
// The main process only finds, validates and reads them; evaluation happens in
// the renderer, because the capabilities plugins want (the Web Audio graph,
// player state, UI panels) all live there.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const KNOWN_PERMISSIONS = ['audio', 'player', 'ui', 'storage', 'subtitles'];
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

function pluginsDir() {
    const dir = path.join(app.getPath('userData'), 'plugins');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function disabledSetPath() {
    return path.join(pluginsDir(), 'disabled.json');
}

function readDisabled() {
    try {
        const raw = JSON.parse(fs.readFileSync(disabledSetPath(), 'utf8'));
        return Array.isArray(raw) ? new Set(raw) : new Set();
    } catch (e) {
        return new Set();
    }
}

function writeDisabled(set) {
    try {
        fs.writeFileSync(disabledSetPath(), JSON.stringify([...set]), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

// A manifest is only accepted when every field it declares is sane — a plugin
// with a bad id could otherwise read or clobber another plugin's settings.
function validateManifest(raw, folderName) {
    const errors = [];
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) {
        errors.push('id must be lowercase letters, digits and dashes');
    }
    if (id && id !== folderName) errors.push(`id "${id}" does not match folder "${folderName}"`);
    if (!raw.name || typeof raw.name !== 'string') errors.push('name is required');

    const entry = typeof raw.entry === 'string' && raw.entry ? raw.entry : 'index.js';
    // Entry must stay inside the plugin folder.
    if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) {
        errors.push('entry must be a relative path inside the plugin folder');
    }

    const permissions = Array.isArray(raw.permissions) ? raw.permissions : [];
    const unknown = permissions.filter(p => !KNOWN_PERMISSIONS.includes(p));
    if (unknown.length) errors.push(`unknown permissions: ${unknown.join(', ')}`);

    return {
        ok: errors.length === 0,
        errors,
        manifest: {
            id,
            name: String(raw.name || id),
            version: String(raw.version || '0.0.0'),
            description: String(raw.description || ''),
            author: String(raw.author || ''),
            entry,
            permissions
        }
    };
}

// Returns every plugin folder with its manifest, source and status. Broken
// plugins are reported rather than skipped silently, so the user can see why
// one isn't loading.
function listPlugins() {
    const dir = pluginsDir();
    const disabled = readDisabled();
    const out = [];

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return out;
    }

    for (const dirent of entries) {
        if (!dirent.isDirectory()) continue;
        const folder = dirent.name;
        const root = path.join(dir, folder);
        const manifestPath = path.join(root, 'plugin.json');

        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (e) {
            out.push({ id: folder, name: folder, broken: true, error: `plugin.json: ${e.message}` });
            continue;
        }

        const { ok, errors, manifest } = validateManifest(raw, folder);
        if (!ok) {
            out.push({ id: folder, name: raw.name || folder, broken: true, error: errors.join('; ') });
            continue;
        }

        const entryPath = path.join(root, manifest.entry);
        // Re-check after resolution: a symlink or odd separator could still
        // point outside the plugin folder.
        if (!path.resolve(entryPath).startsWith(path.resolve(root) + path.sep)) {
            out.push({ id: manifest.id, name: manifest.name, broken: true, error: 'entry escapes the plugin folder' });
            continue;
        }

        let source = null;
        let error = null;
        try {
            const stat = fs.statSync(entryPath);
            if (stat.size > MAX_ENTRY_BYTES) error = 'entry file is too large';
            else source = fs.readFileSync(entryPath, 'utf8');
        } catch (e) {
            error = `entry: ${e.message}`;
        }

        out.push({
            ...manifest,
            root,
            enabled: !disabled.has(manifest.id),
            broken: Boolean(error),
            error,
            source
        });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
}

function setPluginEnabled(id, enabled) {
    const disabled = readDisabled();
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    return writeDisabled(disabled);
}

// Copy a plugin folder in from anywhere on disk (the "install" path).
function installPluginFromFolder(sourceDir) {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(sourceDir, 'plugin.json'), 'utf8'));
    } catch (e) {
        return { success: false, error: `No readable plugin.json in that folder` };
    }
    const folderName = typeof raw.id === 'string' ? raw.id.trim() : '';
    const { ok, errors } = validateManifest(raw, folderName);
    if (!ok) return { success: false, error: errors.join('; ') };

    const dest = path.join(pluginsDir(), folderName);
    try {
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(sourceDir, dest, { recursive: true });
    } catch (e) {
        return { success: false, error: e.message };
    }
    return { success: true, id: folderName };
}

// Semver-ish compare, enough for "is the bundled copy newer".
function isNewer(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
}

function readVersion(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')).version || '0.0.0';
    } catch (e) {
        return null;
    }
}

// Plugins shipped with the app live in <app>/plugins and are copied into the
// user's plugin folder, so they behave exactly like installed ones (can be
// disabled, inspected, even edited) rather than being special. A bundled
// plugin is refreshed only when its version is higher than the installed one,
// so shipping a fix reaches users without stomping a folder they edited.
function seedBundledPlugins(appRoot) {
    const src = path.join(appRoot, 'plugins');
    if (!fs.existsSync(src)) return { seeded: [], updated: [] };
    const seeded = [];
    const updated = [];
    let entries;
    try {
        entries = fs.readdirSync(src, { withFileTypes: true });
    } catch (e) {
        return { seeded, updated };
    }
    for (const dirent of entries) {
        if (!dirent.isDirectory()) continue;
        const from = path.join(src, dirent.name);
        const to = path.join(pluginsDir(), dirent.name);

        const installedVersion = fs.existsSync(to) ? readVersion(to) : null;
        if (installedVersion !== null) {
            const bundledVersion = readVersion(from);
            if (!bundledVersion || !isNewer(bundledVersion, installedVersion)) continue;
        }

        try {
            if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
            fs.cpSync(from, to, { recursive: true });
            // Build artifacts, not part of the plugin.
            for (const junk of ['_vendor.js', '_plugin.js']) {
                try { fs.unlinkSync(path.join(to, junk)); } catch (e) { /* absent */ }
            }
            (installedVersion === null ? seeded : updated).push(dirent.name);
        } catch (e) { /* skip this one */ }
    }
    return { seeded, updated };
}

function uninstallPlugin(id) {
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) return { success: false, error: 'Invalid plugin id' };
    const dir = path.join(pluginsDir(), id);
    if (!path.resolve(dir).startsWith(path.resolve(pluginsDir()) + path.sep)) {
        return { success: false, error: 'Invalid plugin id' };
    }
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
        return { success: false, error: e.message };
    }
    const disabled = readDisabled();
    disabled.delete(id);
    writeDisabled(disabled);
    return { success: true };
}

module.exports = {
    pluginsDir,
    seedBundledPlugins,
    listPlugins,
    setPluginEnabled,
    installPluginFromFolder,
    uninstallPlugin,
    KNOWN_PERMISSIONS
};
