// File: src/controllers/directory.controller.js
const { validateToggleAdUserInput } = require('../middleware/validate');
const adManager = require('../services/admanager.service');
const { audit, logger } = require('../utils/logger');
const store = require('../utils/store');
const { parseCsvRows, mapGroupRows, mapUserRows } = require('../utils/csvImport');

function mapUser(u) {
  const hasEmail = !!u.email_address && u.email_address !== '-';
  return {
    samAccountName: u.sam_account_name,
    displayName: u.display_name,
    company: u.company,
    agp: u.agp,
    email: u.email_address,
    accountStatus: u.account_status,
    enabled: u.account_status === 'Enabled',
    canToggle: hasEmail
  };
}

function searchUsers(req, res) {
  const q = (req.query.q || '').toString();
  if (!q.trim()) {
    return res.json({ ok: true, users: [] });
  }
  const rows = store.searchAdUsers(q, 100);
  res.json({ ok: true, users: rows.map(mapUser) });
}

async function toggleUser(req, res) {
  const { error, value } = validateToggleAdUserInput(req.body);
  if (error) {
    return res.status(400).json({ ok: false, message: error.details.map(function (d) { return d.message; }).join('; ') });
  }

  try {
    const result = await adManager.setUserEnabled(value.mail, value.enabled);
    store.setAdUserStatus(value.samAccountName, value.enabled ? 'Enabled' : 'Disabled');
    const entry = {
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      targetEmail: value.mail,
      status: 'Completed',
      type: 'directory_toggle',
      error: null
    };
    audit(entry);
    store.addActivity(entry);
    res.json({ ok: true, message: result.statusMessage || (value.enabled ? 'Enabled' : 'Disabled'), enabled: value.enabled });
  } catch (err) {
    logger.error('directory toggleUser failed for ' + value.mail + ': ' + err.message);
    const entry = {
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      targetEmail: value.mail,
      status: 'Failed',
      type: 'directory_toggle',
      error: err.message
    };
    audit(entry);
    store.addActivity(entry);
    res.status(502).json({ ok: false, message: err.message });
  }
}

function importAdData(req, res) {
  const files = req.files || {};
  const groupsFile = files.groupsFile && files.groupsFile[0];
  const usersFile = files.usersFile && files.usersFile[0];
  const messages = [];
  const errors = [];

  if (!groupsFile && !usersFile) {
    errors.push('Choose at least one CSV file (groups and/or users) to import.');
  }

  if (groupsFile) {
    try {
      const rows = mapGroupRows(parseCsvRows(groupsFile.buffer.toString('utf8')));
      const count = store.upsertAdGroups(rows);
      messages.push('Imported/updated ' + count + ' groups from "' + groupsFile.originalname + '"');
      audit({ timestamp: new Date().toISOString(), operator: req.session.username, status: 'Completed', type: 'ad_import_groups', error: null });
      store.addActivity({ timestamp: new Date().toISOString(), operator: req.session.username, status: 'Completed', type: 'ad_import_groups' });
    } catch (err) {
      logger.error('Groups CSV import failed: ' + err.message);
      errors.push('Groups import failed: ' + err.message);
    }
  }

  if (usersFile) {
    try {
      const rows = mapUserRows(parseCsvRows(usersFile.buffer.toString('utf8')));
      const count = store.upsertAdUsers(rows);
      messages.push('Imported/updated ' + count + ' users from "' + usersFile.originalname + '"');
      audit({ timestamp: new Date().toISOString(), operator: req.session.username, status: 'Completed', type: 'ad_import_users', error: null });
      store.addActivity({ timestamp: new Date().toISOString(), operator: req.session.username, status: 'Completed', type: 'ad_import_users' });
    } catch (err) {
      logger.error('Users CSV import failed: ' + err.message);
      errors.push('Users import failed: ' + err.message);
    }
  }

  res.render('directory', {
    username: req.session.username,
    role: req.session.role,
    importStats: store.getAdImportStats(),
    notice: messages.length ? messages.join('. ') : null,
    error: errors.length ? errors.join('. ') : null
  });
}

module.exports = { searchUsers, toggleUser, importAdData };
