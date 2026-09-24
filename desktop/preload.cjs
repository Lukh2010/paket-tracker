/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('isDesktopApp', true);
contextBridge.exposeInMainWorld('unterwegsDesktop', {
  platform: process.platform,
  version: '1.0.0',
  openAliExpressLogin: () => ipcRenderer.send('open-aliexpress-login'),
});
