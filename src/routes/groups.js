// File: src/routes/groups.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const groupsController = require('../controllers/groups.controller');

// Read-only, non-sensitive: any authenticated operator can search the full imported
// AD group list to avoid retyping partner/group names on the provisioning form.
router.get('/api/search-all', requireAuth, groupsController.searchAllGroups);

router.use(requireAuth);

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
