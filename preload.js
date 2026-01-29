// [2026-01-29 15:20 CET] Preload v1.2.9 — secure bridge + openExternal + copyText
const { contextBridge, ipcRenderer, clipboard } = require('electron');
contextBridge.exposeInMainWorld('chronos', {
  version:(base)=> ipcRenderer.invoke('chronos:version',base),
  status:(base)=>  ipcRenderer.invoke('chronos:status',base),
  list:(base)=>    ipcRenderer.invoke('chronos:list',base),
  purge:(base,min)=> ipcRenderer.invoke('chronos:purge',base,min),
  rmFile:(base,f)=> ipcRenderer.invoke('chronos:rmFile',base,f),
  rmDate:(base,d)=> ipcRenderer.invoke('chronos:rmDate',base,d),
  ping:(base)=>     ipcRenderer.invoke('chronos:ping',base),
  dlUrl:(base,date,name)=> ipcRenderer.invoke('chronos:dl-url',base,date,name),
  zipUrl:(base,date)=>      ipcRenderer.invoke('chronos:zip-url',base,date),
  chooseFolder:()=>         ipcRenderer.invoke('chronos:choose-folder'),
  downloadSelected:(payload)=> ipcRenderer.invoke('chronos:download-selected',payload),
  onDownloadProgress:(cb)=>  ipcRenderer.on('chronos:download-progress',(_e,data)=> cb(data)),
  onDownloadStep:(cb)=>      ipcRenderer.on('chronos:download-step',(_e,data)=> cb(data)),
  scanWifi:()=>              ipcRenderer.invoke('wifi:scan'),
  openExternal:(url)=>       ipcRenderer.invoke('app:open-external', url),
  copyText:(t)=>             clipboard.writeText(String(t||''))  // expose safe clipboard helper
});
// Using clipboard via the preload is the recommended pattern for sandboxed renderers. [4](https://www.electronjs.org/docs/latest/api/clipboard)