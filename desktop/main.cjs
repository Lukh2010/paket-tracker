/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
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

app.on('second-instance', (event, commandLine) => {
  if (Array.isArray(commandLine) && (commandLine.includes('--login') || commandLine.includes('--sync-aliexpress'))) {
    openAliExpressLoginWindow();
    return;
  }
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

async function fetchTrackerParcels() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: 'localhost',
        port: 4317,
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

function openCainiaoVerificationWindow(summary) {
  const items = summary && Array.isArray(summary.items) ? summary.items : [];
  const numbers = items.map((i) => i.number).filter(Boolean);
  const queryList = numbers.length ? numbers.join(',') : '3076443058854663';
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

  verifyWin.loadURL(cainiaoUrl);

  const ses = verifyWin.webContents.session;
  ses.cookies.on('changed', async (event, cookie, cause, removed) => {
    if (!removed && (cookie.domain.includes('cainiao.com') || cookie.name.includes('x5sec'))) {
      try {
        const allCookies = await ses.cookies.get({ domain: '.cainiao.com' });
        const cookieFile = path.join(DATA_DIR, 'cainiao_cookies.json');
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(cookieFile, JSON.stringify(allCookies, null, 2), 'utf-8');
        const cookieStr = allCookies.map((c) => `${c.name}=${c.value}`).join('; ');
        fs.writeFileSync(path.join(DATA_DIR, 'cookies.txt'), cookieStr, 'utf-8');
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

let aeLoginWin = null;
let isAeSyncing = false;

function extractLogisticsFromObject(obj, foundOrderId = null) {
  if (!obj || typeof obj !== 'object') return null;

  const orderId = foundOrderId || obj.tradeId || obj.orderId || obj.outOrderNo;
  let mailNo = obj.mailNo || obj.trackingNo || obj.waybillNo || obj.logisticsNo || obj.copyRealMailNo;

  if (obj.officialWebsiteTrace) {
    if (!mailNo) mailNo = obj.officialWebsiteTrace.mailNo || obj.officialWebsiteTrace.trackingNo;
  }

  const rawEvents = obj.traceList || obj.detailList || obj.events || obj.traces || obj.packageTraceList;

  if (Array.isArray(rawEvents) && rawEvents.length > 0) {
    const events = rawEvents.map((e) => {
      const rawTime = e.time || e.eventTime || e.gmtCreate;
      const timeNum = typeof rawTime === 'number' ? rawTime : Date.parse(rawTime || '');
      const description = e.desc || e.standerdDesc || e.eventDesc || e.description || 'Status-Update';
      const code = e.actionCode || e.code || 'IN_TRANSIT';
      return {
        time: isNaN(timeNum) ? Date.now() : timeNum,
        description,
        code,
      };
    });

    return {
      orderId: orderId ? String(orderId) : null,
      mailNo: mailNo ? String(mailNo) : undefined,
      carrier: obj.cpName || obj.destCpName || 'AliExpress Standard Shipping',
      status: obj.status || (events.length > 0 ? 'DELIVERING' : 'ORDER_PROCESSING'),
      events,
    };
  }

  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      const res = extractLogisticsFromObject(obj[key], orderId);
      if (res) return res;
    }
  }

  return null;
}

function sendTrackingUpdateToServer(extracted) {
  const targetNumber = extracted.orderId || extracted.mailNo;
  if (!targetNumber) return;

  const payload = {
    number: targetNumber,
    internationalNumber: extracted.mailNo && extracted.mailNo !== targetNumber ? extracted.mailNo : undefined,
    updateTracking: {
      number: targetNumber,
      status: extracted.status,
      carrier: extracted.carrier,
      events: extracted.events,
      checkedAt: new Date().toISOString(),
    },
  };

  const req = http.request(
    {
      host: 'localhost',
      port: 4317,
      path: '/api/parcels',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    () => {
      console.log(`[Desktop] Paket ${targetNumber} erfolgreich mit Live-Daten von AliExpress synchronisiert!`);
      void fetchTrackerSummary().then((s) => updateTrayMenu(s));
      if (mainWindow) mainWindow.reload();
    },
  );
  req.on('error', (e) => console.error('[Desktop] Fehler beim Senden des Tracking-Updates:', e));
  req.write(JSON.stringify(payload));
  req.end();
}

ipcMain.on('aliexpress-logistics-captured', (event, rawData) => {
  if (!rawData || typeof rawData !== 'object') return;
  const extracted = extractLogisticsFromObject(rawData);
  if (extracted) {
    console.log('[Desktop] Live-Tracking abgefangen für Order:', extracted.orderId, extracted.mailNo);
    sendTrackingUpdateToServer(extracted);
  }
});

ipcMain.on('aliexpress-dom-scraped', (event, data) => {
  if (!data || !data.orderId) return;
  console.log('[Desktop] DOM-Tracking erkannt für Order:', data.orderId, data.trackingNo);
  if (data.trackingNo || (data.eventsText && data.eventsText.length > 0)) {
    const events = (data.eventsText || []).map((t, idx) => ({
      time: Date.now() - idx * 3600000,
      description: t,
      code: 'IN_TRANSIT',
    }));

    sendTrackingUpdateToServer({
      orderId: data.orderId,
      mailNo: data.trackingNo,
      carrier: 'AliExpress Standard Shipping',
      status: 'DELIVERING',
      events: events.length > 0 ? events : [
        {
          time: Date.now(),
          description: 'In Zustellung über AliExpress',
          code: 'IN_TRANSIT',
        },
      ],
    });
  }
});

ipcMain.on('open-aliexpress-login', () => {
  openAliExpressLoginWindow();
});

function openAliExpressLoginWindow() {
  if (aeLoginWin && !aeLoginWin.isDestroyed()) {
    aeLoginWin.show();
    aeLoginWin.focus();
    return;
  }

  const aePreload = path.join(__dirname, 'aliexpress_preload.cjs');
  aeLoginWin = new BrowserWindow({
    width: 1080,
    height: 820,
    title: 'AliExpress Anmeldung & Live-Synchronisation',
    icon: ICON_PATH,
    webPreferences: {
      partition: 'persist:aliexpress',
      nodeIntegration: false,
      contextIsolation: false,
      preload: aePreload,
    },
  });

  aeLoginWin.loadURL('https://www.aliexpress.com/p/order/index.html');

  const ses = aeLoginWin.webContents.session;
  ses.cookies.on('changed', async (event, cookie, cause, removed) => {
    if (!removed && cookie.domain.includes('aliexpress.com')) {
      try {
        const allCookies = await ses.cookies.get({ domain: '.aliexpress.com' });
        const cookieFile = path.join(DATA_DIR, 'aliexpress_cookies.json');
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(cookieFile, JSON.stringify(allCookies, null, 2), 'utf-8');
      } catch {}
    }
  });

  aeLoginWin.on('closed', async () => {
    aeLoginWin = null;
    await syncAliExpressOrdersInBackground();
    await triggerServerRefresh();
    const updated = await fetchTrackerSummary();
    updateTrayMenu(updated);
    if (mainWindow) mainWindow.reload();
  });
}

async function syncAliExpressOrdersInBackground() {
  if (isAeSyncing) return;
  isAeSyncing = true;
  try {
    const summary = await fetchTrackerSummary();
    const items = summary && Array.isArray(summary.items) ? summary.items : [];
    const pendingOrders = items.filter(
      (i) => !i.isDelivered && /^\d{16}$/.test(i.number),
    );

    if (pendingOrders.length === 0) return;
    console.log(`[Desktop] Synchronisiere ${pendingOrders.length} AliExpress-Sendungen im Hintergrund...`);

    const aePreload = path.join(__dirname, 'aliexpress_preload.cjs');

    for (const order of pendingOrders) {
      const bgWin = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
          partition: 'persist:aliexpress',
          nodeIntegration: false,
          contextIsolation: false,
          preload: aePreload,
        },
      });

      const orderUrl = `https://track.aliexpress.com/logisticsdetail.htm?tradeId=${order.number}`;
      try {
        bgWin.loadURL(orderUrl);
        await new Promise((r) => setTimeout(r, 6000));
      } catch (e) {
        console.error(`[Desktop] Fehler beim Laden von ${order.number}:`, e);
      } finally {
        if (!bgWin.isDestroyed()) bgWin.destroy();
      }
    }
  } catch (err) {
    console.error('[Desktop] Hintergrund-Sync Fehler:', err);
  } finally {
    isAeSyncing = false;
  }
}

function updateTrayMenu(summary) {
  if (!tray) return;

  const active = summary ? summary.activeCount : '?';
  const delivered = summary ? summary.deliveredCount : '?';
  const total = summary ? summary.totalCount : '?';

  tray.setToolTip(
    `Unterwegs · ${active} unterwegs, ${delivered} angekommen (Gesamt: ${total})`,
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
      if (pData && Array.isArray(pData.parcels)) {
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
      label: 'AliExpress verbinden (Live-Sync)',
      click: () => {
        openAliExpressLoginWindow();
      },
    },
    {
      label: 'AliExpress-Sendungen im Hintergrund abrufen',
      click: async () => {
        tray.setToolTip('Unterwegs · Synchronisiere AliExpress...');
        await syncAliExpressOrdersInBackground();
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

  if (process.argv.includes('--verify')) {
    void fetchTrackerSummary().then((s) => openCainiaoVerificationWindow(s));
  }

  if (process.argv.includes('--login') || process.argv.includes('--sync-aliexpress')) {
    openAliExpressLoginWindow();
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
      spawnedServer.kill('SIGTERM');
    } catch {}
  }
});

app.on('window-all-closed', (e) => {
  // Do NOT quit when all windows are closed; keep running in tray/background!
  e.preventDefault();
});
