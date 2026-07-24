// File: src/utils/adHelpers.js
const crypto = require('crypto');

const SAM_MAX_LENGTH = parseInt(process.env.SAM_MAX_LENGTH || '20', 10);
const UNSAFE_CHARS = /[,+"\\<>;\r\n=]/g;

function sanitizeForAD(value) {
  if (!value) return '';
  return value.toString().replace(UNSAFE_CHARS, '').trim();
}

function truncate(value, max) {
  const limit = max || SAM_MAX_LENGTH;
  const str = (value || '').toString();
  if (str.length <= limit) {
    return { value: str, truncated: false };
  }
  return { value: str.slice(0, limit), truncated: true };
}

function buildGroupName(partnerName, partnerId) {
  const cleanName = sanitizeForAD(partnerName).replace(/\s+/g, ' ').trim();
  const cleanId = sanitizeForAD(partnerId).toString().trim();
  return `${cleanName}-RDS-${cleanId}`;
}

function buildGroupDN(groupName, groupOU) {
  return `CN=${groupName},${groupOU}`;
}

function generatePassword(length = 14) {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '!@#$%';
  const all = lower + upper + digits + special;
  const pick = (set) => set[crypto.randomInt(set.length)];

  const required = [pick(lower), pick(upper), pick(digits), pick(special)];
  const rest = [];
  for (let i = required.length; i < length; i++) {
    rest.push(pick(all));
  }

  const chars = required.concat(rest);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { sanitizeForAD, truncate, buildGroupName, buildGroupDN, generatePassword, SAM_MAX_LENGTH };
