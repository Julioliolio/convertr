const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 480,
    minHeight: 400,
    title: 'Converter',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const { startServer } = require('./server');

  startServer(0).then((port) => {
    createWindow(port);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
