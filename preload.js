const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startDrag: (filePath) => ipcRenderer.send('ondragstart', filePath),
  getOutputPath: (jobId) => ipcRenderer.invoke('get-output-path', jobId),
});
