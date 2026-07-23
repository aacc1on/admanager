// File: src/routes/index.js
const express = require('express');
const router = express.Router();
const { streamProvisioning } = require('../controllers/provisioning.controller');
const adManager = require('../services/admanager.service');
const { logger } = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const store = require('../utils/store');

router.get('/login', function (req, res) {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

router.post('/login', function (req, res) {
  const { username, password } = req.body;
  const user = store.findUserByUsername(username || '');

  if (!user || !store.verifyPassword(user, password || '')) {
    return res.render('login', { error: 'Invalid username or password' });
  }

  if (user.status !== 'active') {
    return res.render('login', { error: 'This account has been blocked. Contact an administrator.' });
  }

  req.session.authenticated = true;
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.redirect('/');
});

router.post('/logout', function (req, res) {
  req.session.destroy(function () {
    res.redirect('/login');
  });
});

router.get('/', requireAuth, function (req, res) {
  res.render('index', {
    username: req.session.username,
    role: req.session.role,
    groupOu: process.env.GROUP_OU || '',
    samMaxLength: process.env.SAM_MAX_LENGTH || '20'
  });
});

router.get('/test-connection', requireAuth, async function (req, res) {
  try {
    await adManager.testConnection();
    res.json({ ok: true, message: 'Connection successful. AuthToken is valid and ADManager Plus is reachable.' });
  } catch (err) {
    logger.warn('Test connection failed: ' + err.message);
    res.json({ ok: false, message: err.message });
  }
});

router.get('/provision/stream', requireAuth, streamProvisioning);

module.exports = router;
