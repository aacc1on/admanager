// File: src/middleware/auth.js
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.authenticated && req.session.role === 'admin') {
    return next();
  }
  return res.status(403).send('Forbidden: admin access required');
}

module.exports = { requireAuth, requireAdmin };
