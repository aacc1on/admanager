// File: src/controllers/groups.controller.js
const { validateToggleAdUserInput } = require('../middleware/validate');
const { parseGroupName } = require('../utils/adHelpers');
const adManager = require('../services/admanager.service');
const { audit, logger } = require('../utils/logger');
const store = require('../utils/store');

function searchAllGroups(req, res) {
  const q = (req.query.q || '').toString();
  if (!q.trim()) {
    return res.json({ ok: true, groups: [] });
  }
  const rows = store.searchAdGroups(q, 50);
  const groups = rows.map(function (g) {
    const parts = parseGroupName(g.sam_account_name);
    return {
      samAccountName: g.sam_account_name,
      partner: parts ? parts.partner : g.sam_account_name,
      partnerId: parts ? parts.partnerId : '',
      parsed: !!parts
    };
  });
  res.json({ ok: true, groups: groups });
}

function getGroupMembers(req, res) {
  const partner = (req.query.partner || '').toString();
  if (!partner.trim()) {
    return res.status(400).json({ ok: false, message: 'partner is required' });
  }

  // Sourced from the imported directory (ad_users), which covers every AD export
  // upload plus every user this app has provisioned — not capped at 500 like the
  // live ADManager Plus SearchUser API, so no group's membership gets truncated.
  const rows = store.getAdUsersByCompany(partner);
  const members = rows.map(function (u) {
    const hasEmail = !!u.email_address && u.email_address !== '-';
    return {
      samAccountName: u.sam_account_name,
      displayName: u.display_name,
      email: u.email_address,
      enabled: u.account_status === 'Enabled',
      canToggle: hasEmail
    };
  });
  res.json({ ok: true, members: members });
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
      type: 'group_toggle',
      error: null
    };
    audit(entry);
    store.addActivity(entry);
    res.json({ ok: true, message: result.statusMessage || (value.enabled ? 'Enabled' : 'Disabled'), enabled: value.enabled });
  } catch (err) {
    logger.error('toggleUser failed for ' + value.mail + ': ' + err.message);
    const entry = {
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      targetEmail: value.mail,
      status: 'Failed',
      type: 'group_toggle',
      error: err.message
    };
    audit(entry);
    store.addActivity(entry);
    res.status(502).json({ ok: false, message: err.message });
  }
}

module.exports = { searchAllGroups, getGroupMembers, toggleUser };
