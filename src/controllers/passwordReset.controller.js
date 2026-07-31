// File: src/controllers/passwordReset.controller.js
const { validateResetPasswordInput } = require('../middleware/validate');
const { generatePassword } = require('../utils/adHelpers');
const adManager = require('../services/admanager.service');
const { sendPasswordResetEmail } = require('../services/mail.service');
const { audit, logger } = require('../utils/logger');
const store = require('../utils/store');

function sseSend(res, event) {
  res.write('data: ' + JSON.stringify(event) + '\n\n');
}

async function streamPasswordReset(req, res) {
  const startedAt = Date.now();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();

  const rawEntries = Array.isArray(req.query.entries)
    ? req.query.entries
    : (req.query.entries ? [req.query.entries] : []);

  const input = {
    entries: rawEntries.map(function (e) {
      const notifyRaw = (e && e.notifyEmail) || '';
      const notifyEmails = notifyRaw
        .split(/[,;]+/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      return {
        targetEmail: e && e.targetEmail,
        notifyEmails: notifyEmails
      };
    })
  };

  function finishWithError(step, message) {
    sseSend(res, { step: step, status: 'error', message: message });
    const entry = {
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      status: 'Failed',
      executionTimeMs: Date.now() - startedAt,
      error: message,
      type: 'password_reset'
    };
    audit(entry);
    store.addActivity(entry);
    sseSend(res, { step: 'done', status: 'error', message: message });
    res.end();
  }

  sseSend(res, { step: 'validate', status: 'progress', message: 'Validating input...' });

  const { error, value } = validateResetPasswordInput(input);
  if (error) {
    finishWithError('validate', error.details.map(function (d) { return d.message; }).join('; '));
    return;
  }

  sseSend(res, {
    step: 'validate',
    status: 'done',
    message: 'Input is valid (' + value.entries.length + ' user' + (value.entries.length > 1 ? 's' : '') + ')'
  });

  let successCount = 0;
  let emailErrorCount = 0;
  let failCount = 0;

  for (let i = 0; i < value.entries.length; i++) {
    const entry = value.entries[i];
    const step = 'reset' + i;
    const entryStartedAt = Date.now();
    const notifyJoined = entry.notifyEmails.join(', ');
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      targetEmail: entry.targetEmail,
      notifyEmail: notifyJoined,
      status: 'Failed',
      executionTimeMs: null,
      error: null,
      type: 'password_reset'
    };

    try {
      sseSend(res, {
        step: step,
        status: 'progress',
        message: 'User ' + (i + 1) + ' of ' + value.entries.length + ': looking up ' + entry.targetEmail + ' in AD and resetting password...'
      });

      const newPassword = generatePassword();
      const resetResult = await adManager.resetPassword(entry.targetEmail, newPassword);

      sseSend(res, {
        step: step,
        status: 'done',
        message: 'Password reset for ' + (resetResult.sAMAccountName || entry.targetEmail)
      });

      try {
        await sendPasswordResetEmail(notifyJoined, entry.targetEmail, newPassword);
        auditEntry.status = 'Completed';
        successCount++;
        sseSend(res, { step: step + '-email', status: 'done', message: 'Email sent to ' + notifyJoined });
      } catch (mailErr) {
        logger.error('Password reset email failed for ' + notifyJoined + ': ' + mailErr.message);
        auditEntry.status = 'CompletedWithEmailError';
        auditEntry.error = mailErr.message;
        emailErrorCount++;
        sseSend(res, {
          step: step + '-email',
          status: 'error',
          message: 'Password was reset, but sending the email failed. Copy the credentials below to send manually (shown only once).'
        });
        sseSend(res, {
          step: 'credentials',
          status: 'warn',
          message: 'Credentials to send manually',
          accountEmail: entry.targetEmail,
          notifyEmail: notifyJoined,
          password: newPassword
        });
      }
    } catch (resetErr) {
      // Most likely cause: no AD user exists with this email address.
      logger.error(resetErr.stack || resetErr.message);
      auditEntry.status = 'Failed';
      auditEntry.error = resetErr.message;
      failCount++;
      sseSend(res, { step: step, status: 'error', message: 'Could not reset password for ' + entry.targetEmail + ': ' + resetErr.message });
    }

    auditEntry.executionTimeMs = Date.now() - entryStartedAt;
    audit(auditEntry);
    store.addActivity(auditEntry);
  }

  const total = value.entries.length;
  let overallStatus = 'success';
  let doneMessage = 'Reset ' + successCount + ' of ' + total + ' user' + (total > 1 ? 's' : '') + ' successfully';
  if (failCount > 0 || emailErrorCount > 0) {
    overallStatus = failCount === total ? 'error' : 'partial';
    if (emailErrorCount > 0) {
      doneMessage += ', ' + emailErrorCount + ' with email delivery errors (see credentials above)';
    }
    if (failCount > 0) {
      doneMessage += ', ' + failCount + ' failed';
    }
  }

  logger.info('Password reset batch finished in ' + (Date.now() - startedAt) + 'ms: ' + doneMessage);
  sseSend(res, { step: 'done', status: overallStatus, message: doneMessage });
  res.end();
}

module.exports = { streamPasswordReset };
