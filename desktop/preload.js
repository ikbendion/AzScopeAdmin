const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, typed API to the renderer.
// No Node.js APIs leak into the renderer process.
contextBridge.exposeInMainWorld('api', {
  getConfig:    ()       => ipcRenderer.invoke('get-config'),
  saveConfig:   (cfg)    => ipcRenderer.invoke('save-config', cfg),
  login:        ()       => ipcRenderer.invoke('login'),
  logout:       ()       => ipcRenderer.invoke('logout'),
  searchSPs:    (term)   => ipcRenderer.invoke('search-sps', term),
  loadGraphSP:  ()       => ipcRenderer.invoke('load-graph-sp'),
  assignScope:  (args)   => ipcRenderer.invoke('assign-scope', args),
  openExternal: (url)    => ipcRenderer.invoke('open-external', url),
});
