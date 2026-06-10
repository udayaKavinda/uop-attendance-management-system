const courseService = require('../services/course.service');
const sessionService = require('../services/session.service');

async function list(req, res) {
  const items = await courseService.listActiveForStudent();
  return res.json({ items });
}

async function listRunning(req, res) {
  const items = await sessionService.getRunningCoursesForStudent();
  return res.json({ items });
}

module.exports = { list, listRunning };
