// File: src/server.js
require('dotenv').config();
const { ensureBootstrapAdmin } = require('./utils/store');
ensureBootstrapAdmin();

const app = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('User Provisioning app listening on port ' + PORT);
});
