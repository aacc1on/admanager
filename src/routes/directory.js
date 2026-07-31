// File: src/routes/directory.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const directoryController = require('../controllers/directory.controller');
const store = require('../utils/store');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    cb(null, /\.csv$/i.test(file.originalname));
  }
});

router.use(requireAuth);

router.get('/', function (req, res) {
  res.render('directory', {
    username: req.session.username,
    role: req.session.role,
    importStats: store.getAdImportStats(),
    notice: null,
    error: null
  });
});

router.get('/api/search', directoryController.searchUsers);
router.post('/api/toggle', directoryController.toggleUser);
router.post(
  '/import',
  upload.fields([{ name: 'groupsFile', maxCount: 1 }, { name: 'usersFile', maxCount: 1 }]),
  directoryController.importAdData
);

module.exports = router;
