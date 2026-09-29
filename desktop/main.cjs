/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  shell,
  utilityProcess,
  dialog,
} = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const { collectChanges } = require('./notifications.cjs');

const IS_SMOKE_TEST = process.argv.includes('--smoke-test');
if (IS_SMOKE_TEST) {
  if (!process.env.UNTERWEGS_DATA_DIR || !process.env.UNTERWEGS_PORT) throw new Error('Smoke test requires isolated data directory and port');
  app.setPath('userData', path.join(process.env.UNTERWEGS_DATA_DIR, 'electron-test'));
}
const SERVER_PORT = Number(process.env.UNTERWEGS_PORT || 4317);
const SERVER_HOST = app.isPackaged ? '127.0.0.1' : 'localhost';
const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
const PROJECT_DIR = path.resolve(__dirname, '..');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');
const DATA_DIR = process.env.UNTERWEGS_DATA_DIR || path.join(
  process.env.XDG_DATA_HOME || path.join(require('os').homedir(), '.local/share'),
  'unterwegs',
);
const DATA_FILE = path.join(DATA_DIR, 'parcels.json');

const NOTIFICATION_FILE = path.join(DATA_DIR, 'notifications.json');
let notificationState = {};
let notificationSettings = { enabled: true, quietHours: false };
try {
  const saved = JSON.parse(fs.readFileSync(NOTIFICATION_FILE, 'utf8'));
  notificationState = saved.state || {};
  notificationSettings = { ...notificationSettings, ...saved.settings };
} catch {
  /* First launch starts with a silent baseline. */
}
function saveNotificationState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      NOTIFICATION_FILE + '.tmp',
      JSON.stringify({
        state: notificationState,
        settings: notificationSettings,
      }),
    );
    fs.renameSync(NOTIFICATION_FILE + '.tmp', NOTIFICATION_FILE);
  } catch (err) {
    console.error('[Notifications] State could not be saved:', err.message);
  }
}
function notifyChanges(summary) {
  if (!Array.isArray(summary?.shipments)) return;
  const hour = new Date().getHours();
  const result = collectChanges(summary.shipments, notificationState, {
    enabled: notificationSettings.enabled,
    quiet: notificationSettings.quietHours && (hour >= 22 || hour < 8),
  });
  notificationState = result.state;
  saveNotificationState();
  if (!Notification.isSupported()) return;
  for (const shipment of result.changes) {
    const notification = new Notification({
      title: shipment.name,
      body: shipment.status,
      icon: ICON_PATH,
    });
    notification.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      void mainWindow.loadURL(
        SERVER_URL + '/#shipment=' + encodeURIComponent(shipment.id),
      );
    });
    notification.show();
  }
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let spawnedServer = null;
let hasShownTrayNotice = false;

// Command line options
const isBackgroundStart =
  process.argv.includes('--background') || process.argv.includes('--minimized');

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // If an instance is already running, quit this invocation.
  // The existing instance will receive 'second-instance' and show its window.
  app.quit();
  process.exit(0);
}

app.on('second-instance', (event, commandLine) => {
  if (Array.isArray(commandLine) && commandLine.includes('--verify')) {
    void fetchTrackerSummary().then((s) => openCainiaoVerificationWindow(s));
    return;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function checkServerReady(port = SERVER_PORT) {
  return new Promise((resolve) => {
    // Try both IPv6 and IPv4
    const req = http.request(
      {
        host: SERVER_HOST,
        port: port,
        path: '/api/ai/summary',
        method: 'GET',
        timeout: 1500,
      },
      (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => {
      // Try ::1
      const req6 = http.request(
        {
          host: '::1',
          port: port,
          path: '/api/ai/summary',
          method: 'GET',
          timeout: 1500,
        },
        (res6) => {
          resolve(res6.statusCode >= 200 && res6.statusCode < 500);
        },
      );
      req6.on('timeout', () => req6.destroy());
      req6.on('error', () => resolve(false));
      req6.end();
    });
    req.end();
  });
}

async function ensureServerRunning() {
  const isUp = await checkServerReady();
  if (isUp) {
    console.log(
      `[Desktop] Background tracker server is already running on port ${SERVER_PORT}.`,
    );
    return;
  }

  console.log(`[Desktop] Starting background tracker server on port ${SERVER_PORT}...`);
  if (app.isPackaged) {
    const runtimeDir = path.join(process.resourcesPath, 'runtime');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    spawnedServer = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], {
      cwd: runtimeDir,
      env: { ...process.env, NODE_ENV: 'production', HOST: SERVER_HOST, PORT: String(SERVER_PORT), UNTERWEGS_DATA_DIR: DATA_DIR, UNTERWEGS_RUNTIME_DIR: runtimeDir },
      stdio: 'pipe',
      serviceName: 'Unterwegs Paketserver',
    });
  } else {
    const vinextBin = path.join(PROJECT_DIR, 'node_modules', '.bin', 'vinext');
    spawnedServer = spawn(process.env.UNTERWEGS_NODE || 'node',
      [vinextBin, 'dev', '--host', 'localhost', '--port', String(SERVER_PORT)],
      { cwd: PROJECT_DIR, env: { ...process.env, PORT: String(SERVER_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  spawnedServer.on('error', (error) => console.error('[Server]', error));

  spawnedServer.stdout.on('data', (d) => process.stdout.write(`[Server] ${d}`));
  spawnedServer.stderr.on('data', (d) => process.stderr.write(`[Server] ${d}`));

  spawnedServer.on('exit', (code) => {
    console.log(`[Desktop] Server process exited with code ${code}`);
    spawnedServer = null;
  });

  // Wait for server to become ready
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkServerReady()) {
      console.log('[Desktop] Server is ready!');
      return;
    }
  }
  throw new Error('Der lokale Paketserver konnte nicht gestartet werden.');
}

async function fetchTrackerSummary() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: '/api/ai/summary',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function fetchTrackerParcels() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: '/api/parcels',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function triggerServerRefresh() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: '/api/parcels/refresh',
        method: 'POST',
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

function openCainiaoVerificationWindow(summary) {
  const items = summary && Array.isArray(summary.items) ? summary.items : [];
  const numbers = items.map((i) => i.number).filter(Boolean);
  const queryList = numbers.length ? numbers.join(',') : '';
  const cainiaoUrl = `https://global.cainiao.com/newDetail.htm?mailNoList=${encodeURIComponent(queryList)}`;

  const verifyWin = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'Cainiao Global Tracking & Verifizierung',
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  void verifyWin.loadURL(cainiaoUrl);

  const ses = verifyWin.webContents.session;
  ses.cookies.on('changed', async (event, cookie, cause, removed) => {
    if (
      !removed &&
      (cookie.domain.includes('cainiao.com') || cookie.name.includes('x5sec'))
    ) {
      try {
        const allCookies = await ses.cookies.get({ domain: '.cainiao.com' });
        const cookieFile = path.join(DATA_DIR, 'cainiao_cookies.json');
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(
          cookieFile,
          JSON.stringify(allCookies, null, 2),
          'utf-8',
        );
        const cookieStr = allCookies
          .map((c) => `${c.name}=${c.value}`)
          .join('; ');
        fs.writeFileSync(
          path.join(DATA_DIR, 'cookies.txt'),
          cookieStr,
          'utf-8',
        );
        console.log('[Desktop] Captured Cainiao cookie:', cookie.name);
      } catch (err) {
        console.error('[Desktop] Failed to save cookie:', err);
      }
    }
  });

  verifyWin.on('closed', async () => {
    await triggerServerRefresh();
    const updated = await fetchTrackerSummary();
    updateTrayMenu(updated);
    if (mainWindow) mainWindow.reload();
  });
}

function updateTrayMenu(summary) {
  if (!tray) return;
  notifyChanges(summary);

  const active = summary ? summary.activeCount : '?';
  const delivered = summary ? summary.deliveredCount : '?';
  const total = summary ? summary.totalCount : '?';

  tray.setToolTip(
    `Unterwegs · ${active} unterwegs, ${delivered} angekommen (Gesamt: ${total} Pakete · ${summary?.articleCount ?? total} Artikel)`,
  );

  // Persist backup summary and parcels to local JSON file
  if (summary && Array.isArray(summary.items)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(DATA_DIR, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf-8',
      );
    } catch {}

    void fetchTrackerParcels().then((pData) => {
      if (!app.isPackaged && pData && Array.isArray(pData.parcels)) {
        try {
          fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(pData.parcels, null, 2),
            'utf-8',
          );
        } catch {}
      }
    });
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Unterwegs öffnen',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: `Status: ${active} unterwegs · ${delivered} angekommen`,
      enabled: false,
    },
    {
      label: 'Tracking jetzt aktualisieren',
      click: async () => {
        tray.setToolTip('Unterwegs · Aktualisiere Sendungen...');
        await triggerServerRefresh();
        const updated = await fetchTrackerSummary();
        updateTrayMenu(updated);
        if (mainWindow) mainWindow.reload();
      },
    },

    {
      label: 'Cainiao im Fenster öffnen (Captcha lösen)',
      click: () => {
        openCainiaoVerificationWindow(summary);
      },
    },
    { type: 'separator' },
    {
      label: 'Benachrichtigungen bei Statusänderungen',
      type: 'checkbox',
      checked: notificationSettings.enabled,
      click: (item) => {
        notificationSettings.enabled = item.checked;
        saveNotificationState();
      },
    },
    {
      label: 'Ruhezeit 22–08 Uhr',
      type: 'checkbox',
      checked: notificationSettings.quietHours,
      click: (item) => {
        notificationSettings.quietHours = item.checked;
        saveNotificationState();
      },
    },
    { type: 'separator' },
    {
      label: 'Im Hintergrund minimieren',
      click: () => {
        if (mainWindow) mainWindow.hide();
      },
    },
    {
      label: 'Vollständig beenden',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip('Unterwegs · AliExpress Tracker');

  // Left click toggles window
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  updateTrayMenu(null);

  // Poll summary periodically to update tray tooltip & menu
  setInterval(async () => {
    const summary = await fetchTrackerSummary();
    if (summary) updateTrayMenu(summary);
  }, 30000);

  // Keep status notifications useful while the window is hidden.
  let checkingTracking = false;
  setInterval(
    async () => {
      if (checkingTracking) return;
      checkingTracking = true;
      try {
        const summary = await fetchTrackerSummary();
        if (summary?.activeCount > 0) {
          await triggerServerRefresh();
          updateTrayMenu(await fetchTrackerSummary());
        }
      } finally {
        checkingTracking = false;
      }
    },
    30 * 60 * 1000,
  );
}

async function createWindow() {
  await ensureServerRunning();

  mainWindow = new BrowserWindow({
    width: 1140,
    height: 840,
    minWidth: 460,
    minHeight: 600,
    title: 'Unterwegs · AliExpress Tracker',
    icon: ICON_PATH,
    show: false, // Don't show until ready
    backgroundColor: '#f4f6f8',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (
      target.protocol === 'https:' &&
      [
        'www.dhl.de',
        'www.dpdgroup.com',
        'www.aliexpress.com',
        'global.cainiao.com',
        't.17track.net',
      ].includes(target.hostname)
    ) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load the web app
  void mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    if (!isBackgroundStart) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Intercept close button -> hide to tray instead of quitting!
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      if (!hasShownTrayNotice && Notification.isSupported()) {
        try {
          new Notification({
            title: 'Unterwegs läuft im Hintergrund',
            body: 'Die App läuft im System-Tray weiter. Klicke auf das Icon im Tray, um das Fenster wieder anzuzeigen.',
            icon: ICON_PATH,
          }).show();
          hasShownTrayNotice = true;
        } catch {}
      }
    }
  });

  // Fetch initial summary for tray
  const initialSummary = await fetchTrackerSummary();
  updateTrayMenu(initialSummary);
}

void app.whenReady().then(async () => {
  if (IS_SMOKE_TEST) {
    let exitCode = 0;
    try {
      if (await checkServerReady()) throw new Error('Smoke-test port is already in use');
      await ensureServerRunning();
      await require('./smoke.cjs').run(SERVER_URL, DATA_DIR, process.argv.includes('--smoke-restart'));
    } catch (error) { console.error(error); exitCode = 1; }
    finally { if (spawnedServer) spawnedServer.kill(); app.exit(exitCode); }
    return;
  }
  createTray();
  try { await createWindow(); }
  catch (error) { dialog.showErrorBox('Unterwegs konnte nicht starten', error.message); app.quit(); return; }

  if (process.argv.includes('--verify')) {
    void fetchTrackerSummary().then((s) => openCainiaoVerificationWindow(s));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (spawnedServer) {
    try {
      spawnedServer.kill();
    } catch {}
  }
});

app.on('window-all-closed', (e) => {
  // Do NOT quit when all windows are closed; keep running in tray/background!
  e.preventDefault();
});
