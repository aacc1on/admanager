// File: src/utils/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { getBaseDir } = require('./baseDir');

const logsDir = path.join(getBaseDir(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(logsDir, 'audit.log') }),
    new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple())
    })
  ]
});

function audit(entry) {
  const safeEntry = Object.assign({}, entry);
  if ('password' in safeEntry) {
    delete safeEntry.password;
  }
  logger.info('AUDIT', safeEntry);
}

module.exports = { logger, audit };
