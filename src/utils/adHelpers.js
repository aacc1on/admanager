// File: src/utils/adHelpers.js
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

module.exports = { sanitizeForAD, truncate, buildGroupName, buildGroupDN, SAM_MAX_LENGTH };
