// Electron main process.
// Owns the lifecycle of the Node backend (and, in dev, the Vite dev server)
// so a single `electron .` / `electron:dev` command boots the whole app.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

const IS_DEV = process.env.IS_DEV === '1';
const SERVER_PORT = process.env.PORT || 8787;
const children = [];

function startBackend() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(SERVER_PORT), IS_DEV: IS_DEV ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`\x1b[35m[server]\x1b[0m ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`\x1b[35m[server]\x1b[0m ${d}`));
  children.push(server);
}

function startViteIfDev() {
  if (!IS_DEV) return;
  const vite = spawn(process.execPath, [path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')], {
    env: { ...process.env, IS_DEV: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  vite.stdout.on('data', (d) => process.stdout.write(`\x1b[36m[vite]\x1b[0m ${d}`));
  vite.stderr.on('data', (d) => process.stderr.write(`\x1b[36m[vite]\x1b[0m ${d}`));
  children.push(vite);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    backgroundColor: '#0f1115',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const url = IS_DEV ? 'http://localhost:5173' : `http://localhost:${SERVER_PORT}`;
  win.loadURL(url);
  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
}

function shutdown() {
  for (const c of children) {
    try { c.kill(); } catch {}
  }
}

app.whenReady().then(() => {
  startBackend();
  startViteIfDev();
  // Give the dev server a moment to come up before loading.
  setTimeout(createWindow, IS_DEV ? 3500 : 800);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', shutdown);
