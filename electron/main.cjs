const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { DEV_ORIGIN, isAllowedDevNavigation, isAllowedExternalUrl, isTrustedIpcSender } = require('./security.cjs');
const { ProfileStore } = require('./profile-store.cjs');
const { CodexAppServerClient } = require('./codex-app-server-client.cjs');
const { AccountService } = require('./account-service.cjs');

const devUrlArg = process.argv.find((arg) => arg.startsWith('--dev-url='));
const devUrl = devUrlArg ? devUrlArg.slice('--dev-url='.length) : null;
const isAllowedDevUrl = devUrl === DEV_ORIGIN;
let mainWindow = null;
let accountService = null;
let shuttingDown = false;

function registerAccountIpc() {
  const handlers = {
    'dashboard:accounts:list': () => accountService.listAccounts(),
    'dashboard:accounts:add': (alias) => accountService.addAccount(alias),
    'dashboard:accounts:login': (accountId) => accountService.startLogin(accountId),
    'dashboard:accounts:refresh': (accountId) => accountService.refreshAccount(accountId),
    'dashboard:accounts:reset-credits': (accountId) => accountService.refreshResetCredits(accountId),
    'dashboard:accounts:reset-consume': (accountId, creditHandle) => accountService.consumeResetCredit(accountId, creditHandle),
    'dashboard:accounts:remove': (accountId) => accountService.removeAccount(accountId)
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedIpcSender(event, mainWindow?.webContents)) throw new Error('Untrusted dashboard IPC sender');
      if (!accountService || shuttingDown) throw new Error('Dashboard service unavailable');
      return handler(...args);
    });
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 760,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f8fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const isAllowed = isAllowedDevUrl && isAllowedDevNavigation(targetUrl);
    if (!isAllowed) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (isAllowedDevUrl) {
    window.loadURL(DEV_ORIGIN);
  } else {
    window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
  mainWindow = window;
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  return window;
}

app.whenReady().then(() => {
  const profilesRoot = path.join(app.getPath('userData'), 'auth-profiles');
  const store = new ProfileStore(profilesRoot);
  accountService = new AccountService({
    store,
    createClient: (codexHome) => new CodexAppServerClient({ codexHome })
  });
  accountService.on('change', (accounts) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dashboard:accounts:changed', accounts);
  });
  registerAccountIpc();
  createWindow();
  void accountService.refreshAll();
  accountService.startPolling(300000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  if (!accountService || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  accountService.closeAll().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
