/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('isDesktopApp', true);
contextBridge.exposeInMainWorld('unterwegsDesktop', {
  platform: process.platform,
  version: '1.0.0',
});

