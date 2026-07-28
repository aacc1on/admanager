// File: src/controllers/directory.controller.js
const { validateToggleAdUserInput } = require('../middleware/validate');
const adManager = require('../services/admanager.service');
const { audit, logger } = require('../utils/logger');
const store = require('../utils/store');

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

module.exports = { searchUsers, toggleUser };
