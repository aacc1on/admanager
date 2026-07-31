// File: scripts/deploy.js
// One-command "build + ship" pipeline: rebuilds dist/UserProvisioning.exe,
// installs/refreshes it at the shared location (C:\ProgramData\UserProvisioning)
// and every user's Desktop shortcut, then restarts the shared instance so it's
// back up immediately — same shared DB, updated code, no manual steps.
//
// Usage: npm run deploy
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SHARED_DIR = 'C:\\ProgramData\\UserProvisioning';
const LAUNCHER_PATH = path.join(SHARED_DIR, 'Start-UserProvisioning.vbs');

function run(cmd, args) {
  console.log('\n> ' + cmd + ' ' + args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
}

function stopRunningInstance() {
  console.log('\n[2/4] Stopping the currently running shared instance (if any)...');
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-Process -Name UserProvisioning -ErrorAction SilentlyContinue | Stop-Process -Force'
    ], { stdio: 'inherit' });
  } catch (err) {
    // nothing was running, or PowerShell had nothing to do — either way, fine
  }
}

function startSharedInstance() {
  if (!fs.existsSync(LAUNCHER_PATH)) return;
  console.log('\n[4/4] Starting the updated shared instance...');
  execFileSync('wscript.exe', [LAUNCHER_PATH], { stdio: 'ignore' });
}

console.log('=== User Provisioning: build + deploy to the shared instance ===');

console.log('\n[1/4] Building dist/UserProvisioning.exe...');
run('node', [path.join(ROOT, 'scripts', 'build-exe.js')]);

stopRunningInstance();

console.log('\n[3/4] Installing to ' + SHARED_DIR + ' and refreshing Desktop shortcuts...');
run('node', [path.join(ROOT, 'scripts', 'install-shared.js')]);

startSharedInstance();

console.log('\nDone — everyone\'s existing Desktop shortcut now opens the updated build against the same shared DB.');
