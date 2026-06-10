const asyncHandler = require('./asyncHandler');
const { respondError, errorHandler } = require('./errorHandler');
const csrf = require('./csrf');
const testAuth = require('./testAuth');
const {
  requireStaff,
  requireAdmin,
  requireStudent,
  requireAnyAuth,
  requireCourseAccess,
  requireSessionAccess,
} = require('./requireAuth');

module.exports = {
  asyncHandler,
  respondError,
  errorHandler,
  csrf,
  testAuth,
  requireStaff,
  requireAdmin,
  requireStudent,
  requireAnyAuth,
  requireCourseAccess,
  requireSessionAccess,
};
