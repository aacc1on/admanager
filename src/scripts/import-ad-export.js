// File: src/scripts/import-ad-export.js
// Re-runnable importer for ADManager Plus CSV exports.
// Usage: node src/scripts/import-ad-export.js
// Drop a fresh export at data/imports/ad_groups.csv and/or data/imports/ad_users.csv and re-run
// any time the data changes — rows are upserted by their SAM Account Name, nothing is duplicated.
// (Same column mapping is also available in-app via the Directory page's CSV import panel.)
const fs = require('fs');
const path = require('path');
const store = require('../utils/store');
const { parseCsvRows, mapGroupRows, mapUserRows } = require('../utils/csvImport');

const IMPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'imports');
const GROUPS_CSV = path.join(IMPORTS_DIR, 'ad_groups.csv');
const USERS_CSV = path.join(IMPORTS_DIR, 'ad_users.csv');

function readCsvRows(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseCsvRows(fs.readFileSync(filePath, 'utf8'));
}

function importGroups() {
  const rows = readCsvRows(GROUPS_CSV);
  if (rows === null) {
    console.log('No groups CSV found at ' + GROUPS_CSV + ' — skipping.');
    return 0;
  }
  return store.upsertAdGroups(mapGroupRows(rows));
}

function importUsers() {
  const rows = readCsvRows(USERS_CSV);
  if (rows === null) {
    console.log('No users CSV found at ' + USERS_CSV + ' — skipping.');
    return 0;
  }
  return store.upsertAdUsers(mapUserRows(rows));
}

const groupCount = importGroups();
const userCount = importUsers();
console.log('Imported/updated ' + groupCount + ' groups and ' + userCount + ' users.');
