// File: src/utils/store.js
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    createdBy TEXT
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    operator TEXT,
    administrator TEXT,
    partner TEXT,
    partnerId TEXT,
    givenName TEXT,
    username TEXT,
    userCreated TEXT,
    emailSent TEXT,
    status TEXT,
    executionTimeMs INTEGER,
    error TEXT
  )
`);

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(function (c) { return c.name === column; })) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('activity', 'type', 'type TEXT');
ensureColumn('activity', 'targetEmail', 'targetEmail TEXT');
ensureColumn('activity', 'notifyEmail', 'notifyEmail TEXT');

function ensureBootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username || !password) return;

  db.prepare(
    'INSERT INTO users (id, username, passwordHash, role, status, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), username, bcrypt.hashSync(password, 10), 'admin', 'active', new Date().toISOString(), 'bootstrap');
}

function getUsers() {
  return db.prepare('SELECT * FROM users ORDER BY createdAt ASC').all();
}

function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username || '') || null;
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function createUser(fields) {
  if (findUserByUsername(fields.username)) {
    throw new Error('A user with this username already exists');
  }
  const user = {
    id: crypto.randomUUID(),
    username: fields.username,
    passwordHash: bcrypt.hashSync(fields.password, 10),
    role: fields.role === 'admin' ? 'admin' : 'operator',
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: fields.createdBy || null
  };
  db.prepare(
    'INSERT INTO users (id, username, passwordHash, role, status, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(user.id, user.username, user.passwordHash, user.role, user.status, user.createdAt, user.createdBy);
  return user;
}

function setUserStatus(id, status) {
  const user = findUserById(id);
  if (!user) throw new Error('User not found');
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  return findUserById(id);
}

function deleteUser(id) {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").get().c;
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.passwordHash);
}

function addActivity(entry) {
  const id = crypto.randomUUID();
  const timestamp = entry.timestamp || new Date().toISOString();
  db.prepare(
    `INSERT INTO activity (id, timestamp, operator, administrator, partner, partnerId, givenName, username, userCreated, emailSent, status, executionTimeMs, error, type, targetEmail, notifyEmail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    timestamp,
    entry.operator || null,
    entry.administrator || null,
    entry.partner || null,
    entry.partnerId || null,
    entry.givenName || null,
    entry.username || null,
    entry.userCreated || null,
    entry.emailSent || null,
    entry.status || null,
    entry.executionTimeMs === undefined || entry.executionTimeMs === null ? null : entry.executionTimeMs,
    entry.error || null,
    entry.type || 'provisioning',
    entry.targetEmail || null,
    entry.notifyEmail || null
  );
}

function getActivity() {
  return db.prepare('SELECT * FROM activity ORDER BY timestamp DESC').all();
}

function getActivityByOperator(username) {
  return db.prepare('SELECT * FROM activity WHERE operator = ? ORDER BY timestamp DESC').all(username);
}

function getKnownGroups() {
  return db.prepare(
    `SELECT partner, partnerId, MAX(timestamp) AS lastUsed, COUNT(*) AS userCount
     FROM activity
     WHERE partner IS NOT NULL AND partnerId IS NOT NULL
     GROUP BY lower(partner), lower(partnerId)
     ORDER BY lastUsed DESC`
  ).all();
}

function getStats() {
  const activity = getActivity();
  const byOperator = {};
  const byDay = {};
  let successCount = 0;
  let failedCount = 0;

  activity.forEach(function (entry) {
    const op = entry.operator || 'unknown';
    byOperator[op] = byOperator[op] || { total: 0, success: 0, failed: 0, lastActivity: entry.timestamp };
    byOperator[op].total += 1;
    if (entry.timestamp > byOperator[op].lastActivity) byOperator[op].lastActivity = entry.timestamp;

    const isSuccess = entry.status === 'Completed' || entry.status === 'CompletedWithEmailError';
    if (isSuccess) {
      successCount += 1;
      byOperator[op].success += 1;
    } else {
      failedCount += 1;
      byOperator[op].failed += 1;
    }

    const day = entry.timestamp.slice(0, 10);
    byDay[day] = byDay[day] || 0;
    if (isSuccess) byDay[day] += 1;
  });

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7Days.push({ day: key, count: byDay[key] || 0 });
  }

  return {
    totalOperations: activity.length,
    successCount: successCount,
    failedCount: failedCount,
    byOperator: byOperator,
    last7Days: last7Days
  };
}

module.exports = {
  ensureBootstrapAdmin,
  getUsers,
  findUserByUsername,
  findUserById,
  createUser,
  setUserStatus,
  deleteUser,
  countAdmins,
  verifyPassword,
  addActivity,
  getActivity,
  getActivityByOperator,
  getStats,
  getKnownGroups
};
