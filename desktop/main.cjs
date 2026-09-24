/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
} = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');
const DATA_DIR = path.join(
  process.env.HOME || '/home/lukheinbach',
  '.local/share/unterwegs',
);
const DATA_FILE = path.join(DATA_DIR, 'parcels.json');

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

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function checkServerReady(port = 4317) {
  return new Promise((resolve) => {
    // Try both IPv6 and IPv4
    const req = http.request(
      {
        host: 'localhost',
        port: port,
        path: '/api/ai/summary',
        method: 'GET',
        timeout: 1500,
      },
      (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
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
      req6.on('error', () => resolve(false));
      req6.end();
    });
    req.end();
  });
}

async function ensureServerRunning() {
  const isUp = await checkServerReady(4317);
  if (isUp) {
    console.log(
      '[Desktop] Background tracker server is already running on port 4317.',
    );
    return;
  }

  console.log('[Desktop] Starting background tracker server on port 4317...');
  const vinextBin = path.join(PROJECT_DIR, 'node_modules', '.bin', 'vinext');
  const nodeBin = fs.existsSync('/usr/bin/node26') ? '/usr/bin/node26' : 'node';

  spawnedServer = spawn(
    nodeBin,
    [vinextBin, 'dev', '--host', '127.0.0.1', '--port', '4317'],
    {
      cwd: PROJECT_DIR,
      env: { ...process.env, PORT: '4317' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  spawnedServer.stdout.on('data', (d) => process.stdout.write(`[Server] ${d}`));
  spawnedServer.stderr.on('data', (d) => process.stderr.write(`[Server] ${d}`));

  spawnedServer.on('exit', (code) => {
    console.log(`[Desktop] Server process exited with code ${code}`);
    spawnedServer = null;
  });

  // Wait for server to become ready
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkServerReady(4317)) {
      console.log('[Desktop] Server is ready!');
      return;
    }
  }
}

async function fetchTrackerSummary() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: 'localhost',
        port: 4317,
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
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function triggerServerRefresh() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: 'localhost',
        port: 4317,
        path: '/api/parcels/refresh',
        method: 'POST',
        timeout: 10000,
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
    req.on('error', () => resolve(null));
    req.end();
  });
}

function updateTrayMenu(summary) {
  if (!tray) return;

  const active = summary ? summary.activeCount : '?';
  const delivered = summary ? summary.deliveredCount : '?';
  const total = summary ? summary.totalCount : '?';

  tray.setToolTip(
    `Unterwegs · ${active} unterwegs, ${delivered} angekommen (Gesamt: ${total})`,
  );

  // Persist backup summary to local JSON file
  if (summary && Array.isArray(summary.items)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(DATA_DIR, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf-8',
      );
    } catch {}
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

  // Load the web app
  mainWindow.loadURL('http://localhost:4317');

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

app.whenReady().then(() => {
  createTray();
  void createWindow();

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
      spawnedServer.kill('SIGTERM');
    } catch {}
  }
});

app.on('window-all-closed', (e) => {
  // Do NOT quit when all windows are closed; keep running in tray/background!
  e.preventDefault();
});
