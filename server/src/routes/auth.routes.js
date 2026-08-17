const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const { oauthLimiter } = require('../config/rateLimit');
const { isGoogleOAuthConfigured } = require('../config/passport');
const { requireAnyAuth } = require('../middlewares/requireAuth');
const authController = require('../controllers/auth.controller');

/** OAuth browser redirects under /auth/* */
const oauthRouter = express.Router();

if (!isGoogleOAuthConfigured()) {
  oauthRouter.get('/google', authController.googleNotConfigured);
} else {
  oauthRouter.get('/google', oauthLimiter, authController.googleAuth);
  oauthRouter.get('/native-return', oauthLimiter, authController.nativeReturn);
  oauthRouter.get('/google/callback', oauthLimiter, authController.googleCallback);
}

/** Session API under /api/* */
const apiAuthRouter = express.Router();

// Credential Manager (native Google sign-in) — the primary path for the Android app.
apiAuthRouter.get('/auth/google-nonce', oauthLimiter, authController.googleNonce);
apiAuthRouter.post('/auth/google-id-token', oauthLimiter, asyncHandler(authController.googleIdToken));

// Custom Tab OAuth fallback — kept so already-installed app versions keep working.
apiAuthRouter.post('/auth/exchange-code', oauthLimiter, asyncHandler(authController.exchangeCode));
apiAuthRouter.get('/me', requireAnyAuth, asyncHandler(authController.me));
apiAuthRouter.post('/logout', authController.logout);

module.exports = { oauthRouter, apiAuthRouter };
