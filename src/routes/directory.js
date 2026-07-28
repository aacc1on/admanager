// File: src/routes/directory.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const directoryController = require('../controllers/directory.controller');
const store = require('../utils/store');

router.use(requireAuth, requireAdmin);

router.get('/', function (req, res) {
  res.render('directory', {
    username: req.session.username,
    role: req.session.role,
    importStats: store.getAdImportStats()
  });
});

router.get('/api/search', directoryController.searchUsers);
router.post('/api/toggle', directoryController.toggleUser);

module.exports = router;
