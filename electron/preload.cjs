const { contextBridge, ipcRenderer } = require('electron');

const api = Object.freeze({
  listAccounts: () => ipcRenderer.invoke('dashboard:accounts:list'),
  addAccount: (alias) => ipcRenderer.invoke('dashboard:accounts:add', alias),
  startLogin: (accountId) => ipcRenderer.invoke('dashboard:accounts:login', accountId),
  refreshAccount: (accountId) => ipcRenderer.invoke('dashboard:accounts:refresh', accountId),
  refreshResetCredits: (accountId) => ipcRenderer.invoke('dashboard:accounts:reset-credits', accountId),
  consumeResetCredit: (accountId, creditHandle) => ipcRenderer.invoke('dashboard:accounts:reset-consume', accountId, creditHandle),
  removeAccount: (accountId) => ipcRenderer.invoke('dashboard:accounts:remove', accountId),
  onAccountsChanged(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, accounts) => callback(accounts);
    ipcRenderer.on('dashboard:accounts:changed', listener);
    return () => ipcRenderer.removeListener('dashboard:accounts:changed', listener);
  }
});

contextBridge.exposeInMainWorld('dashboardRuntime', Object.freeze({ mode: 'live' }));
contextBridge.exposeInMainWorld('dashboardApi', api);
