// [2026-01-29 19:15 CET] Electron main v1.2.10 — security hardening + safe paths + single-instance + navigation guard

const { app, BrowserWindow, ipcMain, net, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

let win;
let downloadFolder = null;

// Keep single instance (better install experience)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Align Windows App User Model ID with installer (taskbar pinning/notifications)
// It’s good practice to set this, and on Squirrel Windows you must align IDs. [6](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
app.setAppUserModelId('com.didakta.chronos');

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,          // Chromium sandbox on the renderer for defense-in-depth [4](https://github.com/WICG/private-network-access/blob/main/explainer.md)
      webSecurity: true,
      enableRemoteModule: false
    }
  });

  // Block unexpected window opens (e.g., target=_blank)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Prevent navigation away from our local UI
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

// --------------------------
// Helper: robust HTTP client
// --------------------------
function getText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => (body += c.toString()));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}

async function getJson(url) {
  const t = await getText(url);
  try { return JSON.parse(t); } catch { return { ok: false, raw: t }; }
}

// --------------------------
// Device endpoints (IPC)
// --------------------------
ipcMain.handle('chronos:version', (_e, base) => getJson(`${base}/api/version`));
ipcMain.handle('chronos:status',  (_e, base) => getJson(`${base}/api/status`));
ipcMain.handle('chronos:list',    (_e, base) => getJson(`${base}/api/list`));
ipcMain.handle('chronos:purge',   (_e, base, min) => getJson(`${base}/api/purge?minFreeMB=${encodeURIComponent(min)}`));
ipcMain.handle('chronos:rmFile',  (_e, base, f) => getJson(`${base}/api/rm?f=${encodeURIComponent(f)}`));
ipcMain.handle('chronos:rmDate',  (_e, base, d) => getJson(`${base}/api/rm?date=${encodeURIComponent(d)}`));
ipcMain.handle('chronos:ping',    (_e, base) => getJson(`${base}/api/ping`));
ipcMain.handle('chronos:dl-url',  (_e, base, date, name) => `${base}/dl?f=/exp/${date}/${encodeURIComponent(name)}`);
ipcMain.handle('chronos:zip-url', (_e, base, date) => `${base}/zip?date=${encodeURIComponent(date)}`);

// --------------------------
// Folder chooser (IPC)
// --------------------------
ipcMain.handle('chronos:choose-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (!res.canceled && res.filePaths && res.filePaths.length) {
    downloadFolder = res.filePaths[0];
    return { ok: true, folder: downloadFolder };
  }
  return { ok: false };
});

// --------------------------
// Open external link (IPC)
// --------------------------
ipcMain.handle('app:open-external', (_e, url) => {
  try { shell.openExternal(url); return { ok: true }; }
  catch (e) { return { ok: false, err: String(e) }; }
});
// shell.openExternal launches the default system browser for a URL. [6](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)

// --------------------------
// Safe path & streaming utils
// --------------------------
function sanitizeFilename(input) {
  // Strip leading dots and replace forbidden Windows characters; keep reasonable Unicode.
  return String(input).replace(/^[.]+/, '').replace(/[\\/:*?"<>|]/g, '_');
}

function safeJoin(baseDir, relativeName) {
  const sanitized = sanitizeFilename(relativeName).replace(/\.\./g, '_'); // kill traversal fragments
  const joined = path.normalize(path.join(baseDir, sanitized));
  const base = path.normalize(baseDir + path.sep);
  if (!joined.startsWith(base)) throw new Error('Path traversal detected');
  return joined;
}

function streamToFile(url, destPath, progId) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on('response', (response) => {
      const headerLen = response.headers['content-length'];
      const total = parseInt(Array.isArray(headerLen) ? (headerLen[0] ?? '0') : (headerLen ?? '0'), 10);
      let received = 0;
      const out = fs.createWriteStream(destPath);
      response.on('data', (chunk) => {
        received += chunk.length;
        out.write(chunk);
        if (win && progId) win.webContents.send('chronos:download-progress', { id: progId, received, total });
      });
      response.on('end', () => out.end(() => resolve({ ok: true, path: destPath })));
      response.on('error', (e) => { out.destroy(); reject(e); });
    });
    request.on('error', reject);
    request.end();
  });
}

ipcMain.handle('chronos:download-selected', async (_e, payload) => {
  const { base, days, files, folder } = payload;
  const target = folder ?? downloadFolder;
  if (!target) return { ok: false, err: 'no folder' };

  try { fs.mkdirSync(target, { recursive: true }); } catch {}

  let i = 0;
  const total = (Array.isArray(days) ? days.length : 0) + (Array.isArray(files) ? files.length : 0);

  // Download ZIPs per day
  for (const d of (days ?? [])) {
    i++;
    const zipName = sanitizeFilename(`Chronos_${d}.zip`);
    const dest = safeJoin(target, zipName);
    await streamToFile(`${base}/zip?date=${encodeURIComponent(d)}`, dest, `day-${d}`);
    if (win) win.webContents.send('chronos:download-step', { done: i, total, label: zipName });
  }

  // Download individual files
  for (const f of (files ?? [])) {
    i++;
    // Keep only the filename segment after /exp/yyyy-mm-dd/
    const parts = String(f).split('/');
    const name = sanitizeFilename(parts.slice(3).join('/') || 'file.bin');
    const dest = safeJoin(target, name);
    const dir = path.dirname(dest);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    await streamToFile(`${base}/dl?f=${encodeURIComponent(f)}`, dest, `file-${name}`);
    if (win) win.webContents.send('chronos:download-step', { done: i, total, label: name });
  }

  return { ok: true, folder: target };
});

// --------------------------
// Wi‑Fi SSID scanning (ASCII-only parsing kept)
// --------------------------
function scanWifiOS() {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd;
    if (platform === 'win32') cmd = 'cmd /c chcp 65001 >nul & netsh wlan show networks mode=Bssid';
    else if (platform === 'darwin') cmd = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s';
    else cmd = 'nmcli -t -f SSID,SIGNAL dev wifi || nmcli -t -f SSID dev wifi';

    exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
      let text = String(stdout ?? '') + String(stderr ?? '');
      text = text.replace(new RegExp('\r', 'g'), '\n'); // keep ASCII '\r'
      const lines = text.split('\n');

      const reSSIDLineWin = new RegExp('^\\s*SSID\\s+\\d+\\s*:\\s*(.+)$', 'i');
      const reSignalWin   = new RegExp('^\\s*Signal\\s*:\\s*(\\d{1,3})%', 'i');
      const reColsSplit   = new RegExp('\\s{2,}');
      const bySsid = new Map();

      if (platform === 'win32') {
        let current = null; let best = -1;
        for (let i=0; i<lines.length; i++) {
          const ln = String(lines[i] ?? '');
          const m = ln.match(reSSIDLineWin);
          if (m) { if (current !== null) { const prev = bySsid.get(current) ?? -1; bySsid.set(current, Math.max(prev, best)); }
                   current = m[1].trim(); best = -1; continue; }
          const s = ln.match(reSignalWin);
          if (s && current !== null) { const pct = Math.max(0, Math.min(100, parseInt(s[1],10) || 0)); best = Math.max(best, pct); }
        }
        if (current !== null) { const prev = bySsid.get(current) ?? -1; bySsid.set(current, Math.max(prev, best)); }
      } else if (platform === 'darwin') {
        for (let i=1; i<lines.length; i++) {
          const row = String(lines[i] ?? '').trim(); if (!row) continue;
          const cols = row.split(reColsSplit); if (cols.length < 3) continue;
          const ssid = (cols[0] ?? '').trim(); if (!ssid || ssid.toUpperCase()==='SSID') continue;
          const rssi = parseInt(cols[2],10);
          const pct = Number.isFinite(rssi) ? Math.max(0, Math.min(100, Math.round(2*(rssi+100)))) : 0;
          const prev = bySsid.get(ssid) ?? -1; bySsid.set(ssid, Math.max(prev, pct));
        }
      } else { // Linux
        for (let i=0; i<lines.length; i++) {
          const row = String(lines[i] ?? '').trim(); if (!row) continue;
          const parts = row.split(':');
          const ssid = (parts[0] ?? '').trim(); if (!ssid || ssid.toUpperCase()==='SSID') continue;
          const sig = parseInt((parts[1] ?? '0'),10) || 0;
          const pct = Math.max(0, Math.min(100, sig));
          const prev = bySsid.get(ssid) ?? -1; bySsid.set(ssid, Math.max(prev, pct));
        }
      }

      const networks = Array.from(bySsid.entries()).map(([ssid, pct]) => ({ ssid, signalPct: Math.max(0, pct) }));
      const found = networks.some(n => /chronos/i.test(n.ssid));
      resolve({ ok:true, platform, found, networks, raw: text.slice(0, 4000) });
    });
  });
}

try { ipcMain.removeHandler('wifi:scan'); } catch {}
ipcMain.handle('wifi:scan', async () => {
  try { return await scanWifiOS(); }
  catch (e) { return { ok: false, err: String(e) }; }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});