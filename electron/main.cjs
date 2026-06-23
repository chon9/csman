// Electron main process for the CS2 Manager portable shell.
// Built into the .exe by electron-builder via the `build` block in package.json.

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'CS2 Manager',
    backgroundColor: '#0d0f14',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The game is local-only (no external API), so no preload bridge needed.
    },
  });

  // Strip the default app menu — the in-game sidebar is the only nav surface needed.
  Menu.setApplicationMenu(null);

  // F12 toggles devtools (useful for support/debugging without rebuilding).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // External links (if any future feature uses them) open in the system browser
  // rather than hijacking the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Dev mode: load the live Vite server when ELECTRON_START_URL is set.
  // Packaged builds: load the bundled dist/index.html via file://.
  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl && !app.isPackaged) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Standard cross-platform behavior; on Windows/Linux quitting the last window quits the app.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
