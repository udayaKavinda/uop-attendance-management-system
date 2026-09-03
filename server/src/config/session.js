const session = require('express-session');
const mongoose = require('mongoose');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;
const { isProd, sessionSecret } = require('./env');

const sessionCookieSecure = isProd;
// OAuth and Capacitor clients require cross-site cookies in production.
const sessionSameSite = sessionCookieSecure ? 'none' : 'lax';

/**
 * How long to wait for the Mongoose connection before giving up on the session
 * store. `asPromise()` resolves when the connection opens and otherwise waits
 * forever — it never rejects — so without this a Mongo outage produced *hung*
 * sign-in requests rather than fast failures: req.logIn() awaited a session
 * write that would never land, connections piled up, and the load balancer saw
 * no errors to act on. (The same hang is why two tests in googleIdToken.test.js
 * failed by timing out rather than by asserting.) Rejecting instead lets
 * connect-mongo raise a store error, which Express turns into a 503.
 */
const STORE_CONNECT_TIMEOUT_MS = 10_000;

// Reuse the Mongoose connection's underlying MongoClient instead of opening a
// second connection pool.
const clientPromise = Promise.race([
  mongoose.connection.asPromise().then((conn) => conn.getClient()),
  new Promise((_resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Session store: MongoDB connection not established')),
      STORE_CONNECT_TIMEOUT_MS,
    );
    // Never hold the process open just for this watchdog.
    if (typeof timer.unref === 'function') timer.unref();
  }),
]);
// The race is consumed by connect-mongo below, but a rejection that nothing has
// attached to yet would surface as an unhandled rejection first.
clientPromise.catch((err) => console.error('[session-store]', err.message));

const sessionStore = MongoStore.create({
  clientPromise,
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
