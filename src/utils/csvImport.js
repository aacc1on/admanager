// File: src/utils/csvImport.js
// Shared CSV parsing for ADManager Plus exports — used by both the CLI
// importer (src/scripts/import-ad-export.js) and the in-app upload feature
// (src/controllers/directory.controller.js) so the column mapping only lives
// in one place.

function parseCsvRows(content) {
  let text = content;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
  if (!lines.length) return [];
  const header = lines[0].split(',').map(function (h) { return h.trim(); });
  return lines.slice(1).map(function (line) {
    const cells = line.split(',');
    const row = {};
    header.forEach(function (key, i) { row[key] = cells[i] !== undefined ? cells[i].trim() : ''; });
    return row;
  });
}

function mapGroupRows(rows) {
  return rows
    .filter(function (r) { return r['SAM Account Name']; })
    .map(function (r) {
      return {
        samAccountName: r['SAM Account Name'],
        groupType: r['Group Type(String)'],
        groupScope: r['Group Scope'],
        domainName: r['Domain Name']
      };
    });
}

function mapUserRows(rows) {
  return rows
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
}

module.exports = { parseCsvRows, mapGroupRows, mapUserRows };
