// File: src/app.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const ejs = require('ejs');
const { getBaseDir } = require('./utils/baseDir');
const routes = require('./routes');
const adminRoutes = require('./routes/admin');
const passwordResetRoutes = require('./routes/passwordReset');
const groupsRoutes = require('./routes/groups');
const directoryRoutes = require('./routes/directory');
const bulkRoutes = require('./routes/bulk');

const app = express();

const BASE_DIR = getBaseDir();

app.engine('ejs', ejs.__express);
app.set('view engine', 'ejs');
app.set('views', path.join(BASE_DIR, 'views'));

app.use(express.static(path.join(BASE_DIR, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use('/admin', adminRoutes);
app.use('/reset-password', passwordResetRoutes);
app.use('/groups', groupsRoutes);
app.use('/directory', directoryRoutes);
app.use('/bulk', bulkRoutes);
app.use('/', routes);

app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

module.exports = app;
