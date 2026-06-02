module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/server/__tests__/**/*.test.js'],
  roots: ['<rootDir>/server'],
  clearMocks: true,
  testTimeout: 10000,
};
