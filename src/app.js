// File: src/app.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const routes = require('./routes');
const adminRoutes = require('./routes/admin');
const passwordResetRoutes = require('./routes/passwordReset');
const groupsRoutes = require('./routes/groups');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.static(path.join(__dirname, '..', 'public')));
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
app.use('/', routes);

app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

module.exports = app;
