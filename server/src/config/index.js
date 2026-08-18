const { applyCors } = require('./cors');
const { applySecurity } = require('./security');
const { applySession } = require('./session');
const { applyPassport } = require('./passport');

module.exports = {
  applyCors,
  applySecurity,
  applySession,
  applyPassport,
};
