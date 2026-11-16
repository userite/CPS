const { app, BrowserWindow, Menu } = require("electron");

const DEV_URL = process.env.CPS_RENDERER_URL || "http://127.0.0.1:5173";

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: "CPS — контролен пулт",
    backgroundColor: "#0c1218",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenu(null);

  window.once("ready-to-show", () => {
    window.show();
  });

  if (app.isPackaged) {
    const path = require("path");
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    window.loadURL(DEV_URL);
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
