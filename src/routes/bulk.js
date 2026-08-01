// File: src/routes/bulk.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const bulkController = require('../controllers/bulk.controller');

router.use(requireAuth);

router.get('/', function (req, res) {
  res.render('bulk', {
    username: req.session.username,
    role: req.session.role
  });
});

router.post('/api/run', bulkController.runBulkAction);

module.exports = router;
