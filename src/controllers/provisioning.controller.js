// File: src/controllers/provisioning.controller.js
const { validateProvisionInput } = require('../middleware/validate');
const { isDuplicate } = require('../utils/dedupe');
const { sanitizeForAD, truncate, buildGroupName, buildGroupDN } = require('../utils/adHelpers');
const adManager = require('../services/admanager.service');
const { sendCredentialsEmail } = require('../services/mail.service');
const { audit, logger } = require('../utils/logger');
const store = require('../utils/store');

const GROUP_OU = process.env.GROUP_OU;
const USER_MAIL_DOMAIN = process.env.USER_MAIL_DOMAIN || 'bcapps.cloud';
const GROUP_TYPE = process.env.GROUP_TYPE || 'Security';
const GROUP_SCOPE = process.env.GROUP_SCOPE || 'Global';
const DOMAIN_NAME = process.env.DOMAIN_NAME;

function sseSend(res, event) {
  res.write('data: ' + JSON.stringify(event) + '\n\n');
}

async function streamProvisioning(req, res) {
  const startedAt = Date.now();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();

  const rawUsers = Array.isArray(req.query.users)
    ? req.query.users
    : (req.query.users ? [req.query.users] : []);

  const input = {
    agpUsername: req.query.agpUsername,
    partnerId: req.query.partnerId,
    partnerName: req.query.partnerName,
    users: rawUsers.map(function (u) {
      return {
        givenName: u && u.givenName,
        altSecurityIdSuffix: u && u.altSecurityIdSuffix,
        email: u && u.email
      };
    })
  };

  function finishWithError(step, message) {
    sseSend(res, { step: step, status: 'error', message: message });
    audit({
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      administrator: input.agpUsername || null,
      partner: input.partnerName || null,
      partnerId: input.partnerId || null,
      userCreated: 'No',
      emailSent: 'No',
      status: 'Failed',
      executionTimeMs: Date.now() - startedAt,
      error: message
    });
    store.addActivity({
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      administrator: input.agpUsername || null,
      partner: input.partnerName || null,
      partnerId: input.partnerId || null,
      userCreated: 'No',
      emailSent: 'No',
      status: 'Failed',
      executionTimeMs: Date.now() - startedAt,
      error: message
    });
    sseSend(res, { step: 'done', status: 'error', message: message });
    res.end();
  }

  sseSend(res, { step: 'validate', status: 'progress', message: 'Validating input...' });

  const { error, value } = validateProvisionInput(input);
  if (error) {
    finishWithError('validate', error.details.map(function (d) { return d.message; }).join('; '));
    return;
  }

  if (req.query.groupConfirmed !== 'true') {
    finishWithError('validate', 'Please confirm the target group name in ADManager Plus before submitting.');
    return;
  }

  const dedupeKeys = value.users.map(function (u) {
    return [value.partnerId, u.givenName, u.email].join('|').toLowerCase();
  });
  const duplicateIndex = dedupeKeys.findIndex(function (key) { return isDuplicate(key); });
  if (duplicateIndex !== -1) {
    const dup = value.users[duplicateIndex];
    finishWithError('validate', 'User #' + (duplicateIndex + 1) + ' (' + dup.email + ') was submitted very recently. Please wait a minute and try again.');
    return;
  }

  sseSend(res, {
    step: 'validate',
    status: 'done',
    message: 'Input is valid (' + value.users.length + ' user' + (value.users.length > 1 ? 's' : '') + ')'
  });

  try {
    const partnerNameClean = sanitizeForAD(value.partnerName);
    const groupName = buildGroupName(partnerNameClean, value.partnerId);
    let groupDn;

    sseSend(res, { step: 'group', status: 'progress', message: 'Checking group management access...' });
    try {
      const existingGroup = await adManager.searchGroup(groupName);
      if (existingGroup) {
        groupDn = existingGroup.DISTINGUISHED_NAME || buildGroupDN(groupName, GROUP_OU);
        sseSend(res, { step: 'group', status: 'done', message: 'Group "' + groupName + '" already exists (verified via API)' });
      } else {
        sseSend(res, { step: 'group', status: 'progress', message: 'Group not found, creating "' + groupName + '" from template...' });
        const created = await adManager.createGroup(groupName);
        groupDn = created.dn;
        sseSend(res, { step: 'group', status: 'done', message: 'Group "' + groupName + '" created via API' });
      }
      store.upsertAdGroups([{
        samAccountName: groupName,
        groupType: GROUP_TYPE,
        groupScope: GROUP_SCOPE,
        domainName: DOMAIN_NAME
      }]);
    } catch (groupErr) {
      groupDn = buildGroupDN(groupName, GROUP_OU);
      sseSend(res, {
        step: 'group',
        status: 'warn',
        message: 'Group management API is not available with the current AuthToken (' + groupErr.message + '). Falling back to the manually confirmed group name.'
      });
    }

    let successCount = 0;
    let emailErrorCount = 0;
    let failCount = 0;

    for (let i = 0; i < value.users.length; i++) {
      const entry = value.users[i];
      const step = 'user' + i;
      const userStartedAt = Date.now();
      const auditEntry = {
        timestamp: new Date().toISOString(),
        operator: req.session.username,
        administrator: value.agpUsername,
        partner: value.partnerName,
        partnerId: value.partnerId,
        givenName: entry.givenName,
        userCreated: 'No',
        emailSent: 'No',
        status: 'Failed',
        executionTimeMs: null,
        error: null
      };

      try {
        const truncatedName = truncate(sanitizeForAD(entry.givenName));
        const safeGivenName = truncatedName.value;
        if (truncatedName.truncated) {
          sseSend(res, {
            step: step,
            status: 'warn',
            message: 'User ' + (i + 1) + ' (' + entry.email + '): givenName truncated to "' + safeGivenName + '" (20-character AD limit)'
          });
        }

        sseSend(res, {
          step: step,
          status: 'progress',
          message: 'Creating user ' + (i + 1) + ' of ' + value.users.length + ' (' + entry.email + ')...'
        });

        const altSecurityIdentities = 'agp:' + sanitizeForAD(entry.altSecurityIdSuffix);
        const createdUser = await adManager.createUser({
          givenName: safeGivenName,
          sn: partnerNameClean,
          company: partnerNameClean,
          memberDn: groupDn,
          altSecurityIdentities: altSecurityIdentities
        });

        // The AD/Exchange template auto-provisions this address for the new account;
        // it's not reachable by the new user until they know the password below.
        const accountEmail = createdUser.logonName + '@' + USER_MAIL_DOMAIN;

        auditEntry.userCreated = 'Yes';
        auditEntry.username = createdUser.logonName;
        auditEntry.targetEmail = accountEmail;
        auditEntry.notifyEmail = entry.email;
        sseSend(res, { step: step, status: 'done', message: 'User created (' + accountEmail + '), added to group via memberof' });

        const nowIso = new Date().toISOString();
        store.upsertAdUsers([{
          samAccountName: createdUser.logonName,
          displayName: safeGivenName,
          company: partnerNameClean,
          agp: entry.altSecurityIdSuffix,
          accountStatus: 'Enabled',
          commonName: safeGivenName,
          emailAddress: accountEmail,
          whenCreated: nowIso,
          whenChanged: nowIso
        }]);

        try {
          await sendCredentialsEmail(entry.email, accountEmail, createdUser.password);
          auditEntry.emailSent = 'Yes';
          auditEntry.status = 'Completed';
          successCount++;
          sseSend(res, { step: step + '-email', status: 'done', message: 'Email sent to ' + entry.email });
        } catch (mailErr) {
          logger.error('Email sending failed for ' + entry.email + ': ' + mailErr.message);
          auditEntry.status = 'CompletedWithEmailError';
          auditEntry.error = mailErr.message;
          emailErrorCount++;
          sseSend(res, {
            step: step + '-email',
            status: 'error',
            message: 'User was created, but sending the email failed. Copy the credentials below to send manually (shown only once).'
          });
          sseSend(res, {
            step: 'credentials',
            status: 'warn',
            message: 'Credentials to send manually',
            accountEmail: accountEmail,
            notifyEmail: entry.email,
            password: createdUser.password
          });
        }
      } catch (userErr) {
        logger.error(userErr.stack || userErr.message);
        auditEntry.status = 'Failed';
        auditEntry.error = userErr.message;
        failCount++;
        sseSend(res, { step: step, status: 'error', message: 'User ' + (i + 1) + ' (' + entry.email + ') failed: ' + userErr.message });
      }

      auditEntry.executionTimeMs = Date.now() - userStartedAt;
      audit(auditEntry);
      store.addActivity(auditEntry);
    }

    const total = value.users.length;
    let overallStatus = 'success';
    let doneMessage = 'Created ' + successCount + ' of ' + total + ' user' + (total > 1 ? 's' : '') + ' successfully';
    if (failCount > 0 || emailErrorCount > 0) {
      overallStatus = failCount === total ? 'error' : 'partial';
      if (emailErrorCount > 0) {
        doneMessage += ', ' + emailErrorCount + ' with email delivery errors (see credentials above)';
      }
      if (failCount > 0) {
        doneMessage += ', ' + failCount + ' failed';
      }
    }

    logger.info('Provisioning batch finished in ' + (Date.now() - startedAt) + 'ms: ' + doneMessage);
    sseSend(res, { step: 'done', status: overallStatus, message: doneMessage });
    res.end();
  } catch (err) {
    logger.error(err.stack || err.message);
    finishWithError('group', err.message);
  }
}

module.exports = { streamProvisioning };
