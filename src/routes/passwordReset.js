// File: src/routes/passwordReset.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { streamPasswordReset } = require('../controllers/passwordReset.controller');

router.use(requireAuth, requireAdmin);

router.get('/', function (req, res) {
  res.render('reset-password', {
    username: req.session.username,
    role: req.session.role
  });
});

router.get('/stream', streamPasswordReset);

module.exports = router;
