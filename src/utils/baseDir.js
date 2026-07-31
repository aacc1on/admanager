// File: src/utils/baseDir.js
const path = require('path');

function isPackagedExe() {
  try {
    return require('node:sea').isSea();
  } catch (err) {
    return false;
  }
}

// When packaged as a Windows .exe (Node SEA), data/views/logs must live next
// to the .exe rather than inside the embedded snapshot, so they resolve from
// process.execPath's folder instead of __dirname.
function getBaseDir() {
  if (isPackagedExe()) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..', '..');
}

module.exports = { getBaseDir, isPackagedExe };
