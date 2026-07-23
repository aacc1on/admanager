// File: src/utils/dedupe.js
const seen = new Map();

function isDuplicate(key, windowSeconds) {
  const window = windowSeconds || parseInt(process.env.DEDUPE_WINDOW_SECONDS || '60', 10);
  const now = Date.now();
  const last = seen.get(key);

  if (seen.size > 1000) {
    for (const [k, ts] of seen) {
      if (now - ts > window * 1000) {
        seen.delete(k);
      }
    }
  }

  if (last && now - last < window * 1000) {
    return true;
  }

  seen.set(key, now);
  return false;
}

module.exports = { isDuplicate };
