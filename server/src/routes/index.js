const { oauthRouter, apiAuthRouter } = require('./auth.routes');
const healthRoutes = require('./health.routes');
const coursesRoutes = require('./courses.routes');
const attendanceRoutes = require('./attendance.routes');
const adminRoutes = require('./admin');
const pagesRoutes = require('./pages.routes');
const webAppRoutes = require('./webApp.routes');
const { WEB_APP_MOUNT_PATH } = require('../utils/constants');

/** Mounts all HTTP routers on the Express app. */
function registerRoutes(app) {
  app.use('/auth', oauthRouter);
  app.use('/api', healthRoutes);
  app.use('/api', apiAuthRouter);
  app.use('/api', coursesRoutes);
  app.use('/api', attendanceRoutes);
  app.use('/api/admin', adminRoutes);
  // Path-scoped, so it cannot shadow the public pages mounted at '/' below.
  app.use(WEB_APP_MOUNT_PATH, webAppRoutes);
  app.use('/', pagesRoutes);
}

module.exports = registerRoutes;
