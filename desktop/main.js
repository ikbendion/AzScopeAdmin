const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { PublicClientApplication } = require('@azure/msal-node');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MS_GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
const SCOPES = [
  'Application.ReadWrite.All',
  'AppRoleAssignment.ReadWrite.All',
  'Directory.Read.All',
];

let win;
let pca = null;
let cachedAccount = null;
let cachedGraphSP = null;

// ── Config ─────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// ── MSAL ───────────────────────────────────────────────────────────────────

function buildPca(config) {
  return new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
    },
  });
}

async function getToken() {
  if (!pca) throw new Error('Not configured. Please complete setup first.');

  // Try silent first
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const result = await pca.acquireTokenSilent({ scopes: SCOPES, account: accounts[0] });
      cachedAccount = accounts[0];
      return result.accessToken;
    } catch {
      // Fall through to interactive
    }
  }

  // Interactive: opens system browser, MSAL starts its own loopback server
  const result = await pca.acquireTokenInteractive({
    scopes: SCOPES,
    openBrowser: async (url) => { await shell.openExternal(url); },
    successTemplate: `
      <html><body style="font-family:system-ui;padding:48px;text-align:center;background:#f3f2f1">
        <h2 style="color:#107C10">Signed in successfully</h2>
        <p style="color:#605E5C">You can close this tab and return to AzScopeAdmin.</p>
      </body></html>`,
    errorTemplate: `
      <html><body style="font-family:system-ui;padding:48px;text-align:center;background:#f3f2f1">
        <h2 style="color:#A4262C">Sign-in failed</h2>
        <p style="color:#605E5C">{error}</p>
      </body></html>`,
  });

  cachedAccount = result.account;
  return result.accessToken;
}

// ── Graph ──────────────────────────────────────────────────────────────────

async function graphGet(path, extraHeaders = {}) {
  const token = await getToken();
  const res = await fetch(GRAPH + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function graphPost(path, body) {
  const token = await getToken();
  const res = await fetch(GRAPH + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── IPC handlers ───────────────────────────────────────────────────────────

function setupIpc() {
  ipcMain.handle('get-config', () => loadConfig());

  ipcMain.handle('save-config', (_, config) => {
    saveConfig(config);
    pca = buildPca(config);
    cachedAccount = null;
    cachedGraphSP = null;
    return { ok: true };
  });

  ipcMain.handle('login', async () => {
    try {
      await getToken(); // triggers interactive if needed
      return {
        ok: true,
        name: cachedAccount?.name || cachedAccount?.username || 'Signed in',
        username: cachedAccount?.username,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('logout', async () => {
    if (pca) {
      const accounts = await pca.getTokenCache().getAllAccounts();
      for (const acct of accounts) {
        await pca.getTokenCache().removeAccount(acct);
      }
    }
    cachedAccount = null;
    cachedGraphSP = null;
    return { ok: true };
  });

  ipcMain.handle('search-sps', async (_, term) => {
    const data = await graphGet(
      `/servicePrincipals?$search="displayName:${encodeURIComponent(term)}"` +
      `&$select=id,displayName,appId&$top=25&$orderby=displayName`,
      { 'ConsistencyLevel': 'eventual' }
    );
    return data.value || [];
  });

  ipcMain.handle('load-graph-sp', async () => {
    if (cachedGraphSP) return cachedGraphSP;
    const data = await graphGet(
      `/servicePrincipals?$filter=appId eq '${MS_GRAPH_APP_ID}'&$select=id,appRoles`
    );
    cachedGraphSP = data.value[0];
    return cachedGraphSP;
  });

  ipcMain.handle('assign-scope', async (_, { spId, resourceId, appRoleId }) => {
    return graphPost(`/servicePrincipals/${spId}/appRoleAssignments`, {
      principalId: spId,
      resourceId,
      appRoleId,
    });
  });

  ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 560,
    minHeight: 500,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  setupIpc();
  createWindow();

  const config = loadConfig();
  if (config?.clientId && config.clientId !== 'YOUR_CLIENT_ID') {
    pca = buildPca(config);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
