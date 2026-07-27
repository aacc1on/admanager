// File: src/controllers/groups.controller.js
const { validateToggleUserInput } = require('../middleware/validate');
const { sanitizeForAD, buildGroupName } = require('../utils/adHelpers');
const adManager = require('../services/admanager.service');
const { audit, logger } = require('../utils/logger');
const store = require('../utils/store');

function listGroups(req, res) {
  const groups = store.getKnownGroups().map(function (g) {
    return {
      partner: g.partner,
      partnerId: g.partnerId,
      groupName: buildGroupName(g.partner, g.partnerId),
      userCount: g.userCount,
      lastUsed: g.lastUsed
    };
  });
  res.json({ ok: true, groups: groups });
}

async function getGroupMembers(req, res) {
  const partner = (req.query.partner || '').toString();
  if (!partner.trim()) {
    return res.status(400).json({ ok: false, message: 'partner is required' });
  }
  const cleanPartner = sanitizeForAD(partner).toLowerCase();

  try {
    const allUsers = await adManager.listAllUsers();
    const members = allUsers
      .filter(function (u) {
        return (u.LAST_NAME || '').toLowerCase() === cleanPartner;
      })
      .map(function (u) {
        const ouName = u.OU_NAME || '';
        return {
          samAccountName: u.SAM_ACCOUNT_NAME,
          displayName: u.DISPLAY_NAME,
          email: u.EMAIL_ADDRESS,
          ouName: ouName,
          enabled: !/disabled/i.test(ouName)
        };
      });
    res.json({ ok: true, members: members });
  } catch (err) {
    logger.error('getGroupMembers failed for ' + partner + ': ' + err.message);
    res.status(502).json({ ok: false, message: err.message });
  }
}

async function toggleUser(req, res) {
  const { error, value } = validateToggleUserInput(req.body);
  if (error) {
    return res.status(400).json({ ok: false, message: error.details.map(function (d) { return d.message; }).join('; ') });
  }

  try {
    const result = await adManager.setUserEnabled(value.mail, value.enabled);
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

module.exports = { listGroups, getGroupMembers, toggleUser };
