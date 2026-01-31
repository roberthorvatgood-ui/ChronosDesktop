/**
 * main.js
 * [Updated 2026-01-30 23:59 CET] Compat Bridge
 * - Keeps new features (locale handler, progress, prod CSP)
 * - Restores old working behaviors:
 *   • Default /api/version|status|list when no {paths} provided
 *   • Accepts legacy IPC signatures (base as string)
 *   • Adds legacy IPC aliases (chronos:dl-url, chronos:zip-url, app:open-external, chronos:download-selected)
 *   • Downloads accept either absolute href OR legacy /exp/... paths
 *   • Day ZIP route is /zip?date=<YYYY-MM-DD> (as in the old app)
 */

const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

let mainWindow;
let downloadFolder = null;
const IS_DEV = !app.isPackaged;

// ---------------- HTTP helpers (Node/Electron fetch) ----------------
function withTimeout(ms){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms); return {signal:c.signal,cancel:()=>clearTimeout(t)}; }
async function httpGet(url, opts = {}){ const {timeoutMs=8000}=opts; const t=withTimeout(timeoutMs); const res=await fetch(url,{method:'GET',signal:t.signal}); t.cancel(); if(!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`); return res; }
async function httpJson(url, opts = {}){ const r=await httpGet(url,opts); const ct=(r.headers.get('content-type')||'').toLowerCase(); if(ct.includes('application/json')) return r.json(); const txt=(await r.text()).trim(); try{return JSON.parse(txt);}catch{return { _text:txt }}}
async function streamToFile(url, outPath, progId){
  await fsp.mkdir(path.dirname(outPath), { recursive:true });
  const res = await httpGet(url, { timeoutMs: 0 });
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(outPath); let received = 0;
  const reader = res.body.getReader();
  try {
    while(true){ const {done, value} = await reader.read(); if(done) break;
      if(value?.length){ out.write(Buffer.from(value)); received += value.length;
        if(mainWindow) mainWindow.webContents.send('chronos:downloadProgress', { id: progId, received, total });
      }
    }
    out.end();
  } catch(e){ out.destroy(); throw e; }
  return { ok:true, path: outPath };
}

// ---------------- Args normalizer (accept old & new signatures) ----------------
function normArgs(arg){ return (typeof arg === 'string') ? { base: arg } : (arg || {}); }

// ---------------- Window & CSP ----------------
function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1240, height: 900, show:false, backgroundColor:'#0b0d10',
    webPreferences: { preload: path.join(__dirname,'preload.js'), nodeIntegration:false, contextIsolation:true }
  });
  mainWindow.once('ready-to-show', ()=> mainWindow.show());
  mainWindow.loadFile(path.join(__dirname,'renderer','index.html'));

  // Production CSP (no CIDR; allows local nets)
  if(!IS_DEV){
    session.defaultSession.webRequest.onHeadersReceived((details, cb)=>{
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' http://127.0.0.1:* http://localhost:* http://192.168.*.* http://10.*.*.* " +
          Array.from({length:16}, (_,i)=>`http://172.${16+i}.*.*`).join(' '),
        "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"
      ].join('; ');
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy':[csp] } });
    });
  }
}

function registerSingleInstanceLock(){
  const ok=app.requestSingleInstanceLock(); if(!ok){ app.quit(); return false; }
  app.on('second-instance', ()=>{ const w = BrowserWindow.getAllWindows()[0]; if(w){ if(w.isMinimized()) w.restore(); w.focus(); }});
  return true;
}
app.on('ready', ()=>{ if(!registerSingleInstanceLock()) return; createWindow(); });
app.on('window-all-closed', ()=>{ if(process.platform!=='darwin') app.quit(); });
app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow(); });

// ---------------- Locale reader (new) ----------------
function resolveLocalePath(lang){
  const p1 = path.join(__dirname,'renderer',`${lang}.json`);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(app.getAppPath ? app.getAppPath() : process.cwd(),'renderer',`${lang}.json`);
  if (fs.existsSync(p2)) return p2;
  return '';
}
ipcMain.handle('chronos:readLocale', async (_evt, { lang })=>{
  try{ const p=resolveLocalePath((lang||'en').toLowerCase()); if(!p) return { ok:true, data:{} };
    const txt=fs.readFileSync(p,'utf-8'); return { ok:true, data: JSON.parse(txt) };
  }catch(e){ return { ok:false, reason:String(e?.message||e) } }
});

// ---------------- Device endpoints (compat: default /api) ----------------
function urlFor(base, paths, key){
  // If the renderer provided {paths}, use them; else use legacy /api/* (old app behavior)
  if (paths && typeof paths === 'object') {
    const p = key==='version' ? (paths.versionPath||'/version')
          : key==='status'  ? (paths.statusPath ||'/status')
          : key==='list'    ? (paths.listPath   ||'/list')
          : '';
    return new URL(p, base).toString();
  }
  // Legacy default
  const legacy = key==='version' ? '/api/version'
              : key==='status'  ? '/api/status'
              : key==='list'    ? '/api/list' : '';
  return `${base}${legacy}`;
}
ipcMain.handle('chronos:version', async (_evt, arg)=>{
  try{ const { base, paths } = normArgs(arg); const u=urlFor(base, paths, 'version');
    const d = await httpJson(u); let version='';
    if (typeof d === 'string') version=d.trim();
    else if (d && typeof d._text==='string') version=d._text.trim();
    else if (d && typeof d==='object') version=String(d.version ?? d.ver ?? d.fw ?? '');
    return { ok: !!version, version };
  }catch(e){ return { ok:false, reason:String(e?.message||e) } }
});
ipcMain.handle('chronos:status', async (_evt, arg)=>{
  try{ const { base, paths } = normArgs(arg); const u=urlFor(base, paths, 'status');
    const d = await httpJson(u);
    const total=Number((d&&(d.total??d.totalBytes??d.capacity??0))||0);
    const used =Number((d&&(d.used ??d.usedBytes ??d.inUse  ??0))||0);
    return { ok:true, total, used };
  }catch(e){ return { ok:false, reason:String(e?.message||e) } }
});
ipcMain.handle('chronos:list', async (_evt, arg)=>{
  try{ const { base, paths } = normArgs(arg); const u=urlFor(base, paths, 'list');
    const d = await httpJson(u); let arr=[];
    if(Array.isArray(d?.dates)) arr=d.dates; else if(Array.isArray(d?.days)) arr=d.days; else if(Array.isArray(d)) arr=d;
    return { ok:true, dates: arr };
  }catch(e){ return { ok:false, reason:String(e?.message||e), dates:[] } }
});

// ---------------- IPC utils (open, copy, folder) + legacy aliases ----------------
ipcMain.handle('chronos:openExternal', async (_e, { url })=>{ try{ await shell.openExternal(url); return { ok:true }; }catch(e){ return { ok:false, reason:String(e?.message||e) } }});
ipcMain.handle('app:open-external', async (_e, url)=>{ try{ await shell.openExternal(url); return { ok:true }; }catch(e){ return { ok:false, err:String(e) } }}); // legacy

ipcMain.handle('chronos:copyText', async (_e, { text })=>{ try{ clipboard.writeText(text||''); return { ok:true }; }catch(e){ return { ok:false, reason:String(e?.message||e) } }});
ipcMain.handle('chronos:chooseFolder', async ()=>{ try{
  const w=BrowserWindow.getFocusedWindow(); const r=await dialog.showOpenDialog(w,{properties:['openDirectory','createDirectory'],title:'Choose download folder'});
  if(r.canceled || !r.filePaths?.[0]) return { ok:false };
  return { ok:true, folder: (downloadFolder = r.filePaths[0]) };
}catch(e){ return { ok:false, reason:String(e?.message||e) } }});
ipcMain.handle('chronos:choose-folder', async ()=>{ // legacy alias
  const r = await ipcMain.invoke('chronos:chooseFolder'); return r;
});

// ---------------- URL helpers + legacy aliases ----------------
ipcMain.handle('chronos:dlUrl', async (_e, { base, date, name })=>{
  try{ if(!base||!date||!name) throw new Error('Missing base/date/name');
    return `${base}/dl?f=/exp/${encodeURIComponent(date)}/${encodeURIComponent(name)}`;
  }catch{ return '' }
});
ipcMain.handle('chronos:zipUrl', async (_e, { base, date })=>{
  try{ if(!base||!date) throw new Error('Missing base/date');
    return `${base}/zip?date=${encodeURIComponent(date)}`;
  }catch{ return '' }
});
// legacy aliases with hyphens
ipcMain.handle('chronos:dl-url', (_e, base, date, name)=> `${base}/dl?f=/exp/${date}/${encodeURIComponent(name)}`);
ipcMain.handle('chronos:zip-url', (_e, base, date)=> `${base}/zip?date=${encodeURIComponent(date)}`);

// ---------------- Delete file/date ----------------
ipcMain.handle('chronos:rmFile', async (_e, { base, fullPath })=>{
  try{
    if(!base||!fullPath) throw new Error('Missing base or path');
    const url = `${base}/api/rm?f=${encodeURIComponent(fullPath)}`; // keep old semantics
    const r = await httpJson(url);
    return r?.ok ? { ok:true } : { ok:false, reason: r? JSON.stringify(r) : 'fail' };
  }catch(e){ return { ok:false, reason:String(e?.message||e) } }
});
ipcMain.handle('chronos:rmDate', async (_e, base, date)=>{ // legacy style
  try{ const url = `${base}/api/rm?date=${encodeURIComponent(date)}`; return await httpJson(url); }
  catch(e){ return { ok:false, err:String(e) } }
});

// ---------------- Downloader (accept href OR legacy /exp path) + legacy alias ----------------
/** [2026-01-30 23:59 CET] buildDownloadTask — supports absolute /dl?f=… and legacy /exp/... */
function buildDownloadTask(base, entry) {
  const s = String(entry || '');

  // Case 1: absolute URL (e.g., http://<base>/dl?f=/exp/2026-01-28/file.csv)
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);

    // If it's the firmware download endpoint, derive the filename from the `f` param
    if (u.pathname.replace(/\/+$/,'') === '/dl') {
      const f = u.searchParams.get('f') || '';
      const clean = f.replace(/^\/+/, '');                    // drop leading slash
      const rel   = clean.startsWith('exp/') ? clean.slice(4) // exp/2026-01-28/file.csv -> 2026-01-28/file.csv
                                             : clean || 'file.bin';
      const name  = decodeURIComponent(rel.split('/').pop() || 'file.bin');
      return { url: u.toString(), label: name, dest: rel };   // keep day subfolder
    }

    // Any other absolute link → use the last path segment as the filenames
    const name = decodeURIComponent(u.pathname.split('/').pop() || 'file.bin');
    return { url: u.toString(), label: name, dest: name };
  }

  // Case 2: legacy relative path (/exp/2026-01-28/file.csv)
  const f = s;
  const name = decodeURIComponent(f.split('/').pop() || 'file.bin');
  const rel  = f.startsWith('/exp/') ? f.slice('/exp/'.length) : name; // 2026-01-28/file.csv
  return { url: `${base}/dl?f=${encodeURIComponent(f)}`, label: name, dest: rel };
}

ipcMain.handle('chronos:downloadSelected', async (_evt, payload)=>{
  try{
    const { base, days = [], files = [], folder } = payload || {};
    const root = folder || downloadFolder || app.getPath('downloads');
    await fsp.mkdir(root, { recursive:true });

    const tasks = [];

    // Day ZIPs (old behavior: /zip?date=YYYY-MM-DD)
    for (const d of days) tasks.push({ url: `${base}/zip?date=${encodeURIComponent(d)}`, label: `Chronos_${d}.zip`, dest: `Chronos_${d}.zip` });

    // Individual files (accept absolute or /exp/..)
    for (const entry of files) tasks.push(buildDownloadTask(base, entry));

    const total = tasks.length; let done = 0;
    for (const t of tasks){
      const out = path.join(root, t.dest);
      await streamToFile(t.url, out, t.label);
      done++; if (mainWindow) mainWindow.webContents.send('chronos:downloadStep', { done, total, label: t.label });
    }
    return { ok:true, count: tasks.length, folder: root };
  }catch(e){ return { ok:false, reason:String(e?.message||e) } }
});

// legacy alias with hyphenated channel name
ipcMain.handle('chronos:download-selected', async (_e, payload)=> ipcMain.invoke('chronos:downloadSelected', payload));