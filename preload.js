
// [Updated 2026-01-30 21:44 CET] Preload — adds discover() and paths override; keeps interface stable
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chronos', {
  discover: (base) => ipcRenderer.invoke('chronos:discover', { base }),
  version:  (base, paths) => ipcRenderer.invoke('chronos:version', { base, paths }),
  status:   (base, paths) => ipcRenderer.invoke('chronos:status',  { base, paths }),
  list:     (base, paths) => ipcRenderer.invoke('chronos:list',    { base, paths }),
  dlUrl:   (base, date, name) => ipcRenderer.invoke('chronos:dlUrl', { base, date, name }),
  zipUrl:  (base, date)       => ipcRenderer.invoke('chronos:zipUrl', { base, date }),
  rmFile:  (base, fullPath)   => ipcRenderer.invoke('chronos:rmFile', { base, fullPath }),
  chooseFolder: () => ipcRenderer.invoke('chronos:chooseFolder'),
  downloadSelected: (payload) => ipcRenderer.invoke('chronos:downloadSelected', payload),
  openExternal: (url) => ipcRenderer.invoke('chronos:openExternal', { url }),
  copyText:     (text) => ipcRenderer.invoke('chronos:copyText',     { text }),
  readLocale: (lang) => ipcRenderer.invoke('chronos:readLocale', { lang }),
  localPathFor: (base, date, name) => ipcRenderer.invoke('chronos:localPathFor', { date, name }),
  showInFolder: (fullPath) => ipcRenderer.invoke('chronos:showInFolder', { path: fullPath }),
  onDownloadProgress: (cb) => { const ch='chronos:downloadProgress'; ipcRenderer.removeAllListeners(ch); ipcRenderer.on(ch, (_e,d)=> cb && cb(d)); },
  onDownloadStep:     (cb) => { const ch='chronos:downloadStep';     ipcRenderer.removeAllListeners(ch); ipcRenderer.on(ch, (_e,d)=> cb && cb(d)); },
});
