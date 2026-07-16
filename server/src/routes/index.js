const { oauthRouter, apiAuthRouter } = require('./auth.routes');
const healthRoutes = require('./health.routes');
const coursesRoutes = require('./courses.routes');
const attendanceRoutes = require('./attendance.routes');
const bluetoothRoutes = require('./bluetooth.routes');
const adminRoutes = require('./admin');
const pagesRoutes = require('./pages.routes');

/**
 * Mounts all HTTP routers on the Express app.
 * Path prefixes match the original monolithic index.js exactly for API backward compatibility.
 */
function registerRoutes(app) {
  app.use('/auth', oauthRouter);
  app.use('/api', healthRoutes);
  app.use('/api', apiAuthRouter);
  app.use('/api', coursesRoutes);
  app.use('/api', attendanceRoutes);
  app.use('/api', bluetoothRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/', pagesRoutes);
}

module.exports = registerRoutes;
