const sessionService = require('../services/session.service');

async function listRunning(req, res) {
  const items = await sessionService.getRunningCoursesForStudent();
  return res.json({ items });
}

module.exports = { listRunning };
