// File: src/services/mail.service.js
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) {
    throw new Error('SMTP_HOST-ը սահմանված չէ .env-ում');
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_SECURE === 'true',
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });
  return transporter;
}

async function sendCredentialsEmail(toEmail, accountEmail, password) {
  const from = process.env.SMTP_FROM || 'no-reply@localhost';
  const t = getTransporter();
  await t.sendMail({
    from: from,
    to: toEmail,
    subject: 'Your account credentials',
    text: 'Email: ' + accountEmail + '\nPassword: ' + password,
    html: '<p>Email: <b>' + accountEmail + '</b></p><p>Password: <b>' + password + '</b></p>'
  });
}

async function sendPasswordResetEmail(toEmail, accountEmail, password) {
  const from = process.env.SMTP_FROM || 'no-reply@localhost';
  const t = getTransporter();
  await t.sendMail({
    from: from,
    to: toEmail,
    subject: 'Your password has been reset',
    text: 'Email: ' + accountEmail + '\nNew password: ' + password,
    html: '<p>Email: <b>' + accountEmail + '</b></p><p>New password: <b>' + password + '</b></p>'
  });
}

module.exports = { sendCredentialsEmail, sendPasswordResetEmail };
