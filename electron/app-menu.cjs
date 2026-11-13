// The native menu bar is removed on Windows and Linux: the app draws its own
// toolbar, so the strip above it is dead height.
//
// On macOS it is NOT optional. The standard shortcuts there are *driven by
// menu items* rather than by the window, so an app with no menu has no Cmd+Q,
// no Cmd+W, and dead Cmd+C / Cmd+V / Cmd+A in every text field — including the
// URL box and the subtitle editor. The roles below are the system's own, so
// they stay correctly labelled and localised in whatever language macOS is in.
const { Menu } = require('electron');

function buildMacTemplate() {
    return [
        { role: 'appMenu' },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { role: 'togglefullscreen' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' }
            ]
        },
        { role: 'windowMenu' }
    ];
}

function applyAppMenu() {
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null);
        return;
    }
    // Only Cmd-modified accelerators live here, so the player's own single-key
    // bindings (space, arrows, J/K/L) are untouched.
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMacTemplate()));
}

module.exports = { applyAppMenu, buildMacTemplate };
