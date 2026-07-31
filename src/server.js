// File: src/server.js
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { getBaseDir, isPackagedExe } = require('./utils/baseDir');
const { extractEmbeddedAssets, ensureEnvFile } = require('./utils/embeddedAssets');

const BASE_DIR = getBaseDir();
extractEmbeddedAssets(BASE_DIR);
ensureEnvFile(BASE_DIR);

require('dotenv').config({ path: path.join(BASE_DIR, '.env') });

const PORT = process.env.PORT || 3000;
const LOGIN_URL = 'http://localhost:' + PORT + '/login';

// Must fully detach the browser-launcher child from this process — this
// process may call process.exit() right after (the "already running, just
// open a tab" path), and a non-detached child can get cut off along with it
// before it actually gets around to opening anything.
function openBrowser(url) {
  let child;
  if (process.platform === 'win32') {
    child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
  child.on('error', function () { /* best-effort; nothing to do if this fails */ });
  child.unref();
}

function startServer(onListening) {
  const { ensureBootstrapAdmin } = require('./utils/store');
  ensureBootstrapAdmin();
  const app = require('./app');
  app.listen(PORT, function () {
    console.log('User Provisioning app listening on port ' + PORT);
    if (onListening) onListening();
  });
}

if (!isPackagedExe()) {
  // Dev mode (node src/server.js / npm run dev): unchanged behavior — no
  // singleton probe, no auto-opened browser tab on every nodemon restart.
  startServer();
} else {
  // Packaged .exe: several people on this machine may double-click the
  // shortcut throughout the day. Only the first one should actually start
  // the server (and own the shared SQLite DB); everyone after that should
  // just get a browser tab pointed at the one already running.
  const probe = http.get({ host: '127.0.0.1', port: PORT, path: '/login', timeout: 1500 }, function (res) {
    res.resume();
    console.log('User Provisioning is already running on port ' + PORT + ' — opening it in your browser.');
    openBrowser(LOGIN_URL);
    process.exit(0);
  });
  probe.on('timeout', function () {
    probe.destroy();
    startServer(function () { openBrowser(LOGIN_URL); });
  });
  probe.on('error', function () {
    startServer(function () { openBrowser(LOGIN_URL); });
  });
}
