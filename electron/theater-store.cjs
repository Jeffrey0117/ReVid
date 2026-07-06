// Theater course-library persistence (file-based, not localStorage).
//
// Writes are atomic (tmp → rename) with the previous good copy kept as
// .bak, and serialized through a chain so overlapping saves never
// interleave. Loads distinguish "no data yet" from "read/parse failed" —
// the renderer blocks saves on failure so an empty state never overwrites
// the library.
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function getTheaterDataPath() {
    return path.join(app.getPath('userData'), 'theater-data.json');
}

async function readTheaterFile(filePath) {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return { ok: true, data: JSON.parse(raw) };
    } catch (e) {
        return { ok: false, missing: e.code === 'ENOENT', error: e.message };
    }
}

let theaterSaveChain = Promise.resolve();

async function writeTheaterData(data) {
    const dataPath = getTheaterDataPath();
    const tmpPath = `${dataPath}.tmp`;
    try {
        await fs.promises.writeFile(tmpPath, JSON.stringify(data), 'utf-8');
        try {
            await fs.promises.rename(dataPath, `${dataPath}.bak`);
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
        await fs.promises.rename(tmpPath, dataPath);
        return { success: true };
    } catch (e) {
        console.error('[save-theater-data] Error:', e);
        return { success: false, error: e.message };
    }
}

// Resolves when every save accepted so far has hit disk — awaited on quit.
function drainTheaterSaves() {
    return theaterSaveChain;
}

function registerTheaterStore() {
    // Returns { success: true, data } (data null on first run) or
    // { success: false, error }.
    ipcMain.handle('load-theater-data', async () => {
        const dataPath = getTheaterDataPath();
        const main = await readTheaterFile(dataPath);
        if (main.ok) return { success: true, data: main.data };

        if (!main.missing) {
            // Preserve the unreadable file for manual recovery before any future save replaces it
            try {
                await fs.promises.copyFile(dataPath, `${dataPath}.corrupt`);
            } catch (copyErr) {
                console.error('[load-theater-data] Could not preserve corrupt file:', copyErr);
            }
        }

        const bak = await readTheaterFile(`${dataPath}.bak`);
        if (bak.ok) {
            console.error('[load-theater-data] Main file unreadable, recovered from .bak');
            return { success: true, data: bak.data, recovered: true };
        }

        if (main.missing && bak.missing) return { success: true, data: null };

        console.error('[load-theater-data] Error:', main.error || bak.error);
        return { success: false, error: main.error || bak.error };
    });

    ipcMain.handle('save-theater-data', (_event, data) => {
        const run = theaterSaveChain.then(() => writeTheaterData(data));
        theaterSaveChain = run.catch(() => {});
        return run;
    });
}

module.exports = { registerTheaterStore, drainTheaterSaves };
