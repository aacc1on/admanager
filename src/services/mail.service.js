// File: src/services/mail.service.js
const nodemailer = require('nodemailer');
const path = require('path');
const { getBaseDir } = require('../utils/baseDir');
const { logger } = require('../utils/logger');

let transporter = null;

// nodemailer's default is to wait 2 minutes for a connection, which is why
// every failed email used to hang the UI for ~121s. A healthy connection here
// (TLS through Kaspersky's interception) is up in ~2-3s, so an attempt that
// isn't up after these is dead and the next one should start.
const CONNECTION_TIMEOUT_MS = 15000;
const GREETING_TIMEOUT_MS = 15000;
const SOCKET_TIMEOUT_MS = 60000;
// Pauses before the 2nd and 3rd attempt.
const RETRY_DELAYS_MS = [5000, 10000];
// Network-level failures (TCP/TLS never established, greeting never arrived,
// reset, DNS): the server never answered, so a fresh attempt can succeed.
// Anything carrying an SMTP response code (bad credentials, rejected
// recipient, ...) is a definitive answer and isn't retried.
const TRANSIENT_CODES = ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ETLS'];

const LOGO_URL = 'https://www.softconstruct.com/fs/userFiles-v2/softconstruct-18748504/images/logo.svg?v=1762875358';
const BRAND = '#a61e64';
const BRAND_DARK = '#7d1750';
const BRAND_LIGHT = '#fbeaf3';
const BRAND_BORDER = '#eec2da';

const GUIDE_ATTACHMENT = {
  filename: 'Windows App Guide - Information Security.pdf',
  path: path.join(getBaseDir(), 'assets', 'Windows-App-Guide.pdf')
};

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_ALLOW_SELF_SIGNED_TLS } = process.env;
  if (!SMTP_HOST) {
    throw new Error('SMTP_HOST-ը սահմանված չէ .env-ում');
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_SECURE === 'true',
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    // Local antivirus/proxy TLS inspection (e.g. Kaspersky "Scan encrypted
    // connections") substitutes its own certificate for the mail server's,
    // which Node's CA bundle doesn't trust — scoped to only this SMTP socket
    // (not the whole process). Stopgap only, until that software excludes
    // this host/app from inspection — remove SMTP_ALLOW_SELF_SIGNED_TLS once it does.
    tls: SMTP_ALLOW_SELF_SIGNED_TLS === 'true' ? { rejectUnauthorized: false } : undefined
  });
  return transporter;
}

function isTransient(err) {
  return !err.responseCode && TRANSIENT_CODES.indexOf(err.code) !== -1;
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Connections from this network to smtp.gmail.com:465 intermittently never
// get established ("Connection timeout" — nothing reaches the server), and a
// single 2-minute attempt was all an email got. Every retry is a brand-new
// connection, since the transport isn't pooled.
async function sendMail(message) {
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  const failures = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const info = await getTransporter().sendMail(message);
      if (failures.length) {
        logger.warn('Email to ' + message.to + ' delivered on attempt ' + attempt + ' (earlier: ' + failures.join('; ') + ')');
      }
      return info;
    } catch (err) {
      failures.push((err.code || 'ERROR') + ' ' + err.message);
      if (!isTransient(err) || attempt === maxAttempts) {
        if (attempt > 1) err.message += ' (after ' + attempt + ' attempts)';
        throw err;
      }
      const pause = RETRY_DELAYS_MS[attempt - 1];
      logger.warn('Email attempt ' + attempt + '/' + maxAttempts + ' to ' + message.to + ' failed (' + failures[attempt - 1] + '), retrying in ' + pause / 1000 + 's');
      await delay(pause);
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Table-based layout with inline styles so the email renders consistently
// across Gmail, Outlook, and other mail clients.
function renderEmailHtml({ heading, intro, rows, footerNote }) {
  const rowsHtml = rows.map(function (row) {
    return (
      '<tr>' +
        '<td style="padding:6px 0; font-size:13px; color:' + BRAND_DARK + '; font-weight:600; width:140px; vertical-align:top;">' + escapeHtml(row.label) + '</td>' +
        '<td style="padding:6px 0; font-size:14px; color:#1f2430; font-family:Consolas,Menlo,monospace;">' + escapeHtml(row.value) + '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<!doctype html>' +
    '<html lang="en">' +
    '<head>' +
      '<meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      '<title>' + escapeHtml(heading) + '</title>' +
    '</head>' +
    '<body style="margin:0; padding:0; background-color:' + BRAND_LIGHT + '; font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(160deg,' + BRAND_DARK + ' 0%,' + BRAND + ' 45%,#c24a83 100%); background-color:' + BRAND + '; padding:32px 16px;">' +
        '<tr>' +
          '<td align="center">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.25);">' +

              // Header
              '<tr>' +
                '<td align="center" style="padding:32px 24px 20px; background-color:' + BRAND_LIGHT + ';">' +
                  '<img src="' + LOGO_URL + '" alt="SoftConstruct" width="180" style="display:block; max-width:180px; height:auto; margin:0 auto;" />' +
                '</td>' +
              '</tr>' +

              // Body
              '<tr>' +
                '<td style="padding:32px 32px 8px;">' +
                  '<h1 style="margin:0 0 12px; font-size:20px; line-height:1.3; color:#1f2430;">' + escapeHtml(heading) + '</h1>' +
                  '<p style="margin:0 0 20px; font-size:14px; line-height:1.6; color:#555;">' + escapeHtml(intro) + '</p>' +
                  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + BRAND_LIGHT + '; border:1px solid ' + BRAND_BORDER + '; border-radius:8px; padding:16px 18px;">' +
                    rowsHtml +
                  '</table>' +
                  '<p style="margin:24px 0 0; font-size:12.5px; line-height:1.6; color:#9098a3;">' + escapeHtml(footerNote) + '</p>' +
                '</td>' +
              '</tr>' +

              // Footer
              '<tr>' +
                '<td align="center" style="padding:20px 24px 28px;">' +
                  '<p style="margin:0; font-size:11.5px; color:#b3b8c2;">This is an automated message, please do not reply.</p>' +
                '</td>' +
              '</tr>' +

            '</table>' +
          '</td>' +
        '</tr>' +
      '</table>' +
    '</body>' +
    '</html>'
  );
}

async function sendCredentialsEmail(toEmail, accountEmail, password) {
  const from = process.env.SMTP_FROM || 'no-reply@localhost';
  const html = renderEmailHtml({
    heading: 'Your account has been created',
    intro: 'An account has been provisioned for you. Use the credentials below to sign in, and make sure to change your password after your first login.',
    rows: [
      { label: 'Email', value: accountEmail },
      { label: 'Password', value: password }
    ],
    footerNote: 'If you were not expecting this email, please contact your administrator.'
  });
  await sendMail({
    from: from,
    to: toEmail,
    subject: 'Your account credentials',
    text: 'Email: ' + accountEmail + '\nPassword: ' + password,
    html: html,
    attachments: [GUIDE_ATTACHMENT]
  });
}

async function sendPasswordResetEmail(toEmail, accountEmail, password) {
  const from = process.env.SMTP_FROM || 'no-reply@localhost';
  const html = renderEmailHtml({
    heading: 'Your password has been reset',
    intro: 'The password for your account has just been reset. Use the new password below to sign in, and change it once you are logged in.',
    rows: [
      { label: 'Email', value: accountEmail },
      { label: 'New password', value: password }
    ],
    footerNote: 'If you did not request this change, please contact your administrator immediately.'
  });
  await sendMail({
    from: from,
    to: toEmail,
    subject: 'Your password has been reset',
    text: 'Email: ' + accountEmail + '\nNew password: ' + password,
    html: html,
    attachments: [GUIDE_ATTACHMENT]
  });
}

// One consolidated report for a bulk password reset, instead of one email per
// account — the destination is whoever asked for the batch (e.g. the ticket
// requester), not the individual account holders.
async function sendBulkResetReport(toEmail, results) {
  const from = process.env.SMTP_FROM || 'no-reply@localhost';
  const successes = results.filter(function (r) { return r.ok; });
  const failures = results.filter(function (r) { return !r.ok; });

  const rows = successes.map(function (r) { return { label: r.email, value: r.password }; });
  const intro = 'Password reset for ' + successes.length + ' of ' + results.length + ' account(s)' +
    (failures.length ? ' — ' + failures.length + ' failed (see below).' : ' — all succeeded.');
  const footerNote = failures.length
    ? 'Failed: ' + failures.map(function (f) { return f.email + ' (' + f.error + ')'; }).join('; ')
    : 'This is an automated message, please do not reply.';

  const html = renderEmailHtml({ heading: 'Bulk password reset report', intro: intro, rows: rows, footerNote: footerNote });
  const text = successes.map(function (r) { return r.email + ': ' + r.password; }).join('\n') +
    (failures.length ? '\n\nFailed:\n' + failures.map(function (f) { return f.email + ': ' + f.error; }).join('\n') : '');

  await sendMail({
    from: from,
    to: toEmail,
    subject: 'Bulk password reset report (' + successes.length + '/' + results.length + ')',
    text: text,
    html: html
  });
}

module.exports = { sendCredentialsEmail, sendPasswordResetEmail, sendBulkResetReport };
