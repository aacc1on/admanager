// File: src/scripts/import-ad-export.js
// Re-runnable importer for ADManager Plus CSV exports.
// Usage: node src/scripts/import-ad-export.js
// Drop a fresh export at data/imports/ad_groups.csv and/or data/imports/ad_users.csv and re-run
// any time the data changes — rows are upserted by their SAM Account Name, nothing is duplicated.
const fs = require('fs');
const path = require('path');
const store = require('../utils/store');

const IMPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'imports');
const GROUPS_CSV = path.join(IMPORTS_DIR, 'ad_groups.csv');
const USERS_CSV = path.join(IMPORTS_DIR, 'ad_users.csv');

function readCsvRows(filePath) {
  if (!fs.existsSync(filePath)) return null;
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // strip UTF-8 BOM
  const lines = content.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
  if (!lines.length) return [];
  const header = lines[0].split(',').map(function (h) { return h.trim(); });
  return lines.slice(1).map(function (line) {
    const cells = line.split(',');
    const row = {};
    header.forEach(function (key, i) { row[key] = cells[i] !== undefined ? cells[i].trim() : ''; });
    return row;
  });
}

function importGroups() {
  const rows = readCsvRows(GROUPS_CSV);
  if (rows === null) {
    console.log('No groups CSV found at ' + GROUPS_CSV + ' — skipping.');
    return 0;
  }
  const mapped = rows
    .filter(function (r) { return r['SAM Account Name']; })
    .map(function (r) {
      return {
        samAccountName: r['SAM Account Name'],
        groupType: r['Group Type(String)'],
        groupScope: r['Group Scope'],
        domainName: r['Domain Name']
      };
    });
  return store.upsertAdGroups(mapped);
}

function importUsers() {
  const rows = readCsvRows(USERS_CSV);
  if (rows === null) {
    console.log('No users CSV found at ' + USERS_CSV + ' — skipping.');
    return 0;
  }
  const mapped = rows
    .filter(function (r) { return r['SAM Account Name']; })
    .map(function (r) {
      return {
        samAccountName: r['SAM Account Name'],
        displayName: r['Display Name'],
        company: r['Company'],
        agp: r['AGP'],
        accountStatus: r['Account Status'],
        commonName: r['Common Name'],
        emailAddress: r['Email Address'],
        whenCreated: r['When Created'],
        whenChanged: r['When Changed']
      };
    });
  return store.upsertAdUsers(mapped);
}

const groupCount = importGroups();
const userCount = importUsers();
console.log('Imported/updated ' + groupCount + ' groups and ' + userCount + ' users.');
