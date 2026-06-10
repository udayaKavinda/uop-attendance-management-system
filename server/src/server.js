/**
 * Process entry point: loads env, connects MongoDB, starts background jobs, listens for HTTP.
 */
require('./config/env');

const app = require('./app');
const { port } = require('./config/env');
const { connectDatabase, syncAllIndexes, closeDatabase } = require('./config/database');
const { ensureBootstrapAdmin } = require('./services/bootstrap.service');
const { startNonRecurringExpiryJob } = require('./services/sessionExpiry.service');

async function start() {
  await connectDatabase();
  await syncAllIndexes();
  try {
    await ensureBootstrapAdmin();
  } catch (e) {
    console.warn('Bootstrap admin:', e.message);
  }
  startNonRecurringExpiryJob();

  const httpServer = app.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });

  function shutdown(signal) {
    console.log(`[shutdown] received ${signal}`);
    httpServer.close(() => {
      closeDatabase().finally(() => process.exit(0));
    });
    // Planned shutdown — exit 0 even on timeout so process managers don't treat
    // a slow-draining shutdown as a crash and trigger restart/alert loops.
    setTimeout(() => {
      console.warn('[shutdown] timed out — forcing exit');
      process.exit(0);
    }, 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Server startup error', err);
    process.exit(1);
  });
}

module.exports = app;
