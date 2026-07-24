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

  const input = { targetEmail: req.query.targetEmail, notifyEmail: req.query.notifyEmail };

  function logOutcome(status, error) {
    const entry = {
      timestamp: new Date().toISOString(),
      operator: req.session.username,
      targetEmail: input.targetEmail || null,
      notifyEmail: input.notifyEmail || null,
      status: status,
      executionTimeMs: Date.now() - startedAt,
      error: error || null,
      type: 'password_reset'
    };
    audit(entry);
    store.addActivity(entry);
  }

  function finishWithError(step, message) {
    sseSend(res, { step: step, status: 'error', message: message });
    logOutcome('Failed', message);
    sseSend(res, { step: 'done', status: 'error', message: message });
    res.end();
  }

  sseSend(res, { step: 'validate', status: 'progress', message: 'Validating input...' });

  const { error, value } = validateResetPasswordInput(input);
  if (error) {
    finishWithError('validate', error.details.map(function (d) { return d.message; }).join('; '));
    return;
  }

  sseSend(res, { step: 'validate', status: 'done', message: 'Input is valid' });

  try {
    sseSend(res, { step: 'reset', status: 'progress', message: 'Looking up ' + value.targetEmail + ' in AD and resetting password...' });

    const newPassword = generatePassword();
    let resetResult;
    try {
      resetResult = await adManager.resetPassword(value.targetEmail, newPassword);
    } catch (resetErr) {
      // Most likely cause: no AD user exists with this email address.
      finishWithError('reset', 'Could not reset password for ' + value.targetEmail + ': ' + resetErr.message);
      return;
    }

    sseSend(res, {
      step: 'reset',
      status: 'done',
      message: 'Password reset for ' + (resetResult.sAMAccountName || value.targetEmail)
    });

    try {
      await sendPasswordResetEmail(value.notifyEmail, value.targetEmail, newPassword);
      sseSend(res, { step: 'email', status: 'done', message: 'Email sent to ' + value.notifyEmail });
      logOutcome('Completed');
      sseSend(res, { step: 'done', status: 'success', message: 'Password reset for ' + value.targetEmail + ' and emailed to ' + value.notifyEmail });
    } catch (mailErr) {
      logger.error('Password reset email failed for ' + value.notifyEmail + ': ' + mailErr.message);
      sseSend(res, {
        step: 'email',
        status: 'error',
        message: 'Password was reset, but sending the email failed. Copy the credentials below to send manually (shown only once).'
      });
      sseSend(res, {
        step: 'credentials',
        status: 'warn',
        message: 'Credentials to send manually',
        accountEmail: value.targetEmail,
        notifyEmail: value.notifyEmail,
        password: newPassword
      });
      logOutcome('CompletedWithEmailError', mailErr.message);
      sseSend(res, { step: 'done', status: 'partial', message: 'Password reset for ' + value.targetEmail + ', but the notification email failed to send.' });
    }
    res.end();
  } catch (err) {
    logger.error(err.stack || err.message);
    finishWithError('reset', err.message);
  }
}

module.exports = { streamPasswordReset };
