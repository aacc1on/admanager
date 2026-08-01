// File: scripts/install-shared.js
// Installs the already-built .exe (dist/UserProvisioning.exe, see build-exe.js)
// into a machine-wide shared location so every Windows user account on this
// computer talks to the same running instance and the same SQLite DB, then
// puts a shortcut on every user's Desktop that starts it hidden (no console
// window) and opens it in the browser.
//
// Usage: npm run install:shared
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_EXE = path.join(ROOT, 'dist', 'UserProvisioning.exe');
const EXE_NAME = 'UserProvisioning.exe';
const SHARED_DIR = 'C:\\ProgramData\\UserProvisioning';
const LAUNCHER_NAME = 'Start-UserProvisioning.vbs';
const SHORTCUT_NAME = 'User Provisioning.lnk';
const PUBLIC_DESKTOP = 'C:\\Users\\Public\\Desktop';
const OWN_DESKTOP = path.join(process.env.USERPROFILE || '', 'Desktop');
const USERS_ROOT = 'C:\\Users';
const NON_USER_DIRS = ['Public', 'Default', 'Default User', 'All Users', 'TEMP', 'defaultuser0'];

// The Public Desktop is normally mirrored onto every account by Explorer, but
// some domain Group Policies disable that merge — so on top of the Public
// Desktop attempt, also place the shortcut directly on every real user
// profile's own Desktop folder, which always shows regardless of that policy.
function listUserDesktops() {
  let entries;
  try {
    entries = fs.readdirSync(USERS_ROOT, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  return entries
    .filter(function (e) { return e.isDirectory() && NON_USER_DIRS.indexOf(e.name) === -1; })
    .map(function (e) { return { user: e.name, desktop: path.join(USERS_ROOT, e.name, 'Desktop') }; });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

// Returns true only if the .lnk file actually exists afterward — PowerShell's
// own exit code isn't trustworthy here (a thrown COM exception inside the
// script doesn't always propagate as a non-zero process exit code).
function createShortcut(desktopDir, launcherPath) {
  try {
    fs.mkdirSync(desktopDir, { recursive: true });
  } catch (err) {
    return null; // no permission to create/access this Desktop folder — skip it
  }
  const shortcutPath = path.join(desktopDir, SHORTCUT_NAME);
  const psScriptPath = path.join(SHARED_DIR, '_make-shortcut.ps1');
  const psScript = [
    '$ErrorActionPreference = "Stop"',
    '$ws = New-Object -ComObject WScript.Shell',
    '$s = $ws.CreateShortcut("' + shortcutPath + '")',
    '$s.TargetPath = "C:\\Windows\\System32\\wscript.exe"',
    '$s.Arguments = \'"' + launcherPath + '"\'',
    '$s.WorkingDirectory = "' + SHARED_DIR + '"',
    '$s.IconLocation = "' + path.join(SHARED_DIR, EXE_NAME) + ',0"',
    '$s.Description = "User Provisioning"',
    '$s.Save()'
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(psScriptPath, psScript);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath], { stdio: 'pipe' });
  } catch (err) {
    // fall through to the existence check below either way
  } finally {
    fs.rmSync(psScriptPath, { force: true });
  }
  return fs.existsSync(shortcutPath) ? shortcutPath : null;
}

// fs.cpSync (used to seed data/ below) copies each file's ACL as-is from the
// project folder rather than inheriting the shared folder's — so on every
// fresh seed, app.db/logs end up owned/writable only by whoever ran this
// script, and every other Windows account can read but not write the shared
// DB, silently crashing the app for them on startup. Re-grant Modify to all
// local users on every run so this can never regress.
function grantUsersWriteAccess(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    execFileSync('icacls', [dir, '/grant', 'BUILTIN\\Users:(OI)(CI)M', '/T', '/Q'], { stdio: 'pipe' });
  } catch (err) {
    console.error('Could not grant BUILTIN\\Users write access to ' + dir + ': ' + err.message);
  }
}

function main() {
  if (!fs.existsSync(DIST_EXE)) {
    console.error('dist/UserProvisioning.exe not found — run "npm run build:exe" first.');
    process.exit(1);
  }

  console.log('Installing to ' + SHARED_DIR + ' ...');
  fs.mkdirSync(SHARED_DIR, { recursive: true });
  fs.copyFileSync(DIST_EXE, path.join(SHARED_DIR, EXE_NAME));

  // .env: never overwrite a real, already-configured one at the shared
  // location. Only seed it (from the project's .env, if present) on a
  // brand-new install — the .exe would otherwise self-bootstrap a blank
  // placeholder template on its own first run anyway.
  const sharedEnv = path.join(SHARED_DIR, '.env');
  if (!fs.existsSync(sharedEnv)) {
    if (copyIfExists(path.join(ROOT, '.env'), sharedEnv)) {
      console.log('Seeded .env from the project\'s .env.');
    }
  } else {
    console.log('.env already exists at the shared location — left untouched.');
  }

  // data/ (SQLite DB): same rule — never clobber an install that's already
  // live and has its own users/groups/activity.
  const sharedData = path.join(SHARED_DIR, 'data');
  const sharedDb = path.join(sharedData, 'app.db');
  if (!fs.existsSync(sharedDb)) {
    if (copyIfExists(path.join(ROOT, 'data'), sharedData)) {
      console.log('Seeded data/ (existing users, imported AD groups/users, activity) from the project.');
    }
  } else {
    console.log('data/app.db already exists at the shared location — left untouched (this is the live, shared DB).');
  }

  console.log('Granting every local user write access to the shared data/logs (needed for the SQLite DB and log files)...');
  grantUsersWriteAccess(sharedData);
  const sharedLogs = path.join(SHARED_DIR, 'logs');
  fs.mkdirSync(sharedLogs, { recursive: true });
  grantUsersWriteAccess(sharedLogs);

  console.log('Writing hidden launcher (' + LAUNCHER_NAME + ')...');
  const launcherPath = path.join(SHARED_DIR, LAUNCHER_NAME);
  fs.writeFileSync(launcherPath, [
    'Dim fso, shell, dir',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'dir = fso.GetParentFolderName(WScript.ScriptFullName)',
    'Set shell = CreateObject("WScript.Shell")',
    'shell.Run """" & dir & "\\' + EXE_NAME + '""", 0, False'
  ].join('\r\n') + '\r\n');

  console.log('Creating Desktop shortcut at the shared Public Desktop (' + PUBLIC_DESKTOP + ')...');
  const publicShortcut = createShortcut(PUBLIC_DESKTOP, launcherPath);
  if (publicShortcut) {
    console.log('Shortcut created: ' + publicShortcut);
  } else {
    console.error('Could not create the Public Desktop shortcut — this needs administrator rights.');
  }

  console.log('\nCreating/refreshing the shortcut directly on each existing user\'s own Desktop...');
  const userDesktops = listUserDesktops();
  let userSuccessCount = 0;
  userDesktops.forEach(function (u) {
    const shortcutPath = createShortcut(u.desktop, launcherPath);
    if (shortcutPath) {
      userSuccessCount++;
      console.log('  OK: ' + u.user);
    } else {
      console.error('  FAILED: ' + u.user + ' (needs administrator rights, or no Desktop folder yet)');
    }
  });
  console.log(userSuccessCount + ' of ' + userDesktops.length + ' user Desktops updated.');

  if (!publicShortcut && userSuccessCount === 0) {
    console.log('\nFalling back to just your own Desktop instead...');
    const ownShortcut = createShortcut(OWN_DESKTOP, launcherPath);
    if (ownShortcut) {
      console.log('Shortcut created for your account only: ' + ownShortcut);
      console.log('To put it on every user\'s Desktop, re-run "npm run install:shared" from an elevated (Run as Administrator) terminal.');
    } else {
      console.error('Could not create a shortcut anywhere. You can start the app by double-clicking ' + launcherPath + ' directly.');
    }
  }

  console.log('\nDone. Shared install: ' + SHARED_DIR);
}

main();
