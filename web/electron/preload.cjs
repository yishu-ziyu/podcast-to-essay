// Minimal preload. The app talks to the backend over plain HTTP (/api),
// so no privileged Node APIs are exposed to the renderer beyond this stub.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  platform: process.platform,
  isElectron: true,
});
