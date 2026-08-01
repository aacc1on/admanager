// File: src/controllers/bulk.controller.js
const { validateBulkActionInput } = require('../middleware/validate');
const { generatePassword } = require('../utils/adHelpers');
const adManager = require('../services/admanager.service');
const { sendBulkResetReport } = require('../services/mail.service');
const { audit, logger } = require('../utils/logger');
const store = require('../utils/store');

function ndjson(res, event) {
  res.write(JSON.stringify(event) + '\n');
}

async function runBulkAction(req, res) {
  const startedAt = Date.now();
  res.set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });

  const { error, value } = validateBulkActionInput(req.body);
  if (error) {
    ndjson(res, { step: 'validate', status: 'error', message: error.details.map(function (d) { return d.message; }).join('; ') });
    ndjson(res, { step: 'done', status: 'error', message: 'Validation failed' });
    return res.end();
  }

  // Case-insensitive de-dupe, preserving first occurrence order.
  const seen = new Set();
  const emails = value.emails.filter(function (e) {
    const key = e.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  ndjson(res, { step: 'validate', status: 'done', message: emails.length + ' email(s) to process (action: ' + value.action + ')' });

  let successCount = 0;
  let failCount = 0;
  const resetResults = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const step = 'row' + i;
    const rowStartedAt = Date.now();
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      targetEmail: email,
      notifyEmail: value.action === 'reset' ? value.notifyEmail : null,
      status: 'Failed',
      type: 'bulk_' + value.action,
      error: null
    };

    try {
      if (value.action === 'reset') {
        const newPassword = generatePassword();
        const result = await adManager.resetPassword(email, newPassword);
        resetResults.push({ email: email, password: newPassword, ok: true });
        auditEntry.status = 'Completed';
        successCount++;
        ndjson(res, { step: step, status: 'done', message: 'Reset ' + (result.sAMAccountName || email) });
      } else {
        const enabled = value.action === 'enable';
        await adManager.setUserEnabled(email, enabled);
        const localUser = store.getAdUserByEmail(email);
        if (localUser) {
          store.setAdUserStatus(localUser.sam_account_name, enabled ? 'Enabled' : 'Disabled');
        }
        auditEntry.status = 'Completed';
        successCount++;
        ndjson(res, { step: step, status: 'done', message: (enabled ? 'Enabled ' : 'Disabled ') + email });
      }
    } catch (err) {
      failCount++;
      auditEntry.error = err.message;
      if (value.action === 'reset') {
        resetResults.push({ email: email, ok: false, error: err.message });
      }
      ndjson(res, { step: step, status: 'error', message: email + ': ' + err.message });
    }

    auditEntry.executionTimeMs = Date.now() - rowStartedAt;
    audit(auditEntry);
    store.addActivity(auditEntry);
  }

  if (value.action === 'reset' && resetResults.some(function (r) { return r.ok; })) {
    try {
      await sendBulkResetReport(value.notifyEmail, resetResults);
      ndjson(res, { step: 'email', status: 'done', message: 'Report sent to ' + value.notifyEmail });
    } catch (mailErr) {
      logger.error('Bulk reset report email failed: ' + mailErr.message);
      ndjson(res, {
        step: 'email',
        status: 'error',
        message: 'Password(s) were reset, but sending the report failed (' + mailErr.message + '). Copy the results above manually.'
      });
    }
  }

  const overallStatus = failCount === 0 ? 'success' : (successCount > 0 ? 'partial' : 'error');
  const doneMessage = successCount + ' of ' + emails.length + ' succeeded' + (failCount > 0 ? ', ' + failCount + ' failed' : '');
  logger.info('Bulk ' + value.action + ' finished in ' + (Date.now() - startedAt) + 'ms: ' + doneMessage);
  ndjson(res, { step: 'done', status: overallStatus, message: doneMessage });
  res.end();
}

module.exports = { runBulkAction };
