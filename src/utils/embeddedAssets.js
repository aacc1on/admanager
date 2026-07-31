// File: src/utils/embeddedAssets.js
const fs = require('fs');
const path = require('path');
const { isPackagedExe } = require('./baseDir');

// views/public/assets are embedded into the .exe at build time (see
// scripts/build-exe.js) and self-extracted here on every startup, so the
// packaged app is truly a single file to distribute — no companion folders
// need to be copied alongside it.
function extractEmbeddedAssets(baseDir) {
  if (!isPackagedExe()) return;
  let manifest;
  try {
    manifest = JSON.parse(require('node:sea').getAsset('embedded-assets.json', 'utf8'));
  } catch (err) {
    return; // build without embedded assets (e.g. the POC/dev path) — nothing to extract
  }
  Object.keys(manifest).forEach(function (relPath) {
    const dest = path.join(baseDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(manifest[relPath], 'base64'));
  });
}

// A default .env is embedded too, so a completely fresh copy of the .exe can
// run once and get a working (placeholder) config to edit — but an existing,
// already-configured .env next to the .exe is never overwritten.
function ensureEnvFile(baseDir) {
  if (!isPackagedExe()) return;
  const envPath = path.join(baseDir, '.env');
  if (fs.existsSync(envPath)) return;
  let template;
  try {
    template = require('node:sea').getAsset('env-template', 'utf8');
  } catch (err) {
    return;
  }
  fs.writeFileSync(envPath, template);
}

module.exports = { extractEmbeddedAssets, ensureEnvFile };
