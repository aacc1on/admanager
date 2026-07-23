// File: src/routes/admin.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const store = require('../utils/store');

router.use(requireAuth, requireAdmin);

function buildUserRows() {
  const stats = store.getStats();
  return store.getUsers().map(function (u) {
    const opStats = stats.byOperator[u.username] || { total: 0, success: 0, failed: 0, lastActivity: null };
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      createdBy: u.createdBy,
      totalCreated: opStats.total,
      successCreated: opStats.success,
      failedCreated: opStats.failed,
      lastActivity: opStats.lastActivity
    };
  });
}

router.get('/', function (req, res) {
  res.render('admin', {
    currentUsername: req.session.username,
    stats: store.getStats(),
    users: buildUserRows(),
    activity: store.getActivity().slice(0, 100),
    error: null,
    notice: null
  });
});

router.get('/users/:id', function (req, res) {
  const target = store.findUserById(req.params.id);
  if (!target) return res.redirect('/admin');

  const activity = store.getActivityByOperator(target.username);
  const successCount = activity.filter(function (a) { return a.status === 'Completed' || a.status === 'CompletedWithEmailError'; }).length;

  res.render('operator', {
    currentUsername: req.session.username,
    target: target,
    activity: activity,
    successCount: successCount,
    failedCount: activity.length - successCount
  });
});

router.post('/users', function (req, res) {
  const { username, password, role } = req.body;
  try {
    if (!username || !password || password.length < 6) {
      throw new Error('Username and a password of at least 6 characters are required');
    }
    store.createUser({ username: username.trim(), password: password, role: role, createdBy: req.session.username });
    res.render('admin', {
      currentUsername: req.session.username,
      stats: store.getStats(),
      users: buildUserRows(),
      activity: store.getActivity().slice(0, 100),
      error: null,
      notice: 'User "' + username + '" created successfully'
    });
  } catch (err) {
    res.render('admin', {
      currentUsername: req.session.username,
      stats: store.getStats(),
      users: buildUserRows(),
      activity: store.getActivity().slice(0, 100),
      error: err.message,
      notice: null
    });
  }
});

router.post('/users/:id/block', function (req, res) {
  const target = store.findUserById(req.params.id);
  if (!target) return res.redirect('/admin');

  if (target.id === req.session.userId) {
    return res.redirect('/admin');
  }
  if (target.role === 'admin' && target.status === 'active' && store.countAdmins() <= 1) {
    return res.redirect('/admin');
  }

  store.setUserStatus(target.id, target.status === 'active' ? 'blocked' : 'active');
  res.redirect('/admin');
});

router.post('/users/:id/delete', function (req, res) {
  const target = store.findUserById(req.params.id);
  if (!target) return res.redirect('/admin');

  if (target.id === req.session.userId) {
    return res.redirect('/admin');
  }
  if (target.role === 'admin' && store.countAdmins() <= 1) {
    return res.redirect('/admin');
  }

  store.deleteUser(target.id);
  res.redirect('/admin');
});

module.exports = router;
