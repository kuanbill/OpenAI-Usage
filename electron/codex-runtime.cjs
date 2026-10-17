const path = require('node:path');

const CODEX_PLATFORM_DIR = path.join('vendor', 'x86_64-pc-windows-msvc');
const CODEX_ENV_ALLOWLIST = new Set([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_MESSAGES',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR'
]);

function resolveCodexExecutable({ isPackaged, resourcesPath, appPath }) {
  const root = isPackaged
    ? path.join(resourcesPath, 'codex')
    : path.join(appPath, 'node_modules', '@openai', 'codex-win32-x64', CODEX_PLATFORM_DIR);
  return path.join(root, 'bin', 'codex.exe');
}

function buildCodexEnvironment(sourceEnv, codexHome) {
  const environment = {};
  for (const [name, value] of Object.entries(sourceEnv || {})) {
    const normalizedName = name.toUpperCase();
    if (CODEX_ENV_ALLOWLIST.has(normalizedName) && typeof value === 'string') {
      environment[normalizedName] = value;
    }
  }
  environment.CODEX_HOME = codexHome;
  return environment;
}

module.exports = { buildCodexEnvironment, resolveCodexExecutable };
