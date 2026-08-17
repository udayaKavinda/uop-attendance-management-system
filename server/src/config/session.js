const session = require('express-session');
const mongoose = require('mongoose');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;
const { isProd, sessionSecret } = require('./env');

const sessionCookieSecure = isProd;
// Cross-site SPA (different subdomain/port) needs None + Secure in production.
const sessionSameSite = sessionCookieSecure ? 'none' : 'lax';

// Reuse the Mongoose connection's underlying MongoClient instead of opening a
// second connection pool. asPromise() resolves once connectDatabase() connects.
const sessionStore = MongoStore.create({
  clientPromise: mongoose.connection.asPromise().then((conn) => conn.getClient()),
  collectionName: 'sessions',
  ttl: 7 * 24 * 60 * 60,
  touchAfter: 60 * 60,
});
sessionStore.on('error', (err) => console.error('[session-store]', err.message));

function applySession(app) {
  // session support required for Passport's req.login() after OAuth
  app.use(session({
    name: 'attendance.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    store: sessionStore,
    cookie: {
      secure: sessionCookieSecure,
      sameSite: sessionSameSite,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }));
}

module.exports = { applySession, sessionStore };
