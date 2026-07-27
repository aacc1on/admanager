// File: src/routes/groups.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const groupsController = require('../controllers/groups.controller');

// Read-only, non-sensitive: any authenticated operator can look up previously used
// partner/group names to avoid retyping them on the provisioning form.
router.get('/api/list', requireAuth, groupsController.listGroups);

router.use(requireAuth, requireAdmin);

router.get('/', function (req, res) {
  res.render('groups', {
    username: req.session.username,
    role: req.session.role,
    groupOu: process.env.GROUP_OU || '',
    groupTemplateName: process.env.GROUP_TEMPLATE_NAME || 'Partner-Group-Templates',
    domainName: process.env.DOMAIN_NAME || ''
  });
});

router.get('/api/members', groupsController.getGroupMembers);
router.post('/api/toggle', groupsController.toggleUser);

module.exports = router;
