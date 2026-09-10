'use strict';

/**
 * The sender and the checker are in different files and neither imports the
 * other, so nothing stopped them disagreeing about what a return URL may carry.
 * They did: `oauthFailureQuery` began emitting `&domain=<host>` while
 * `parseNativeReturnTarget` still rejected every parameter that was not `code`
 * or `error`, so `/auth/native-return` answered 400 "Invalid return target" and
 * a student who signed in with a non-university account got a blank page
 * instead of being told their address was not eligible.
 *
 * This ties the two together: every query the emitter can produce is fed
 * straight into the parser. A future parameter added to one side and not the
 * other fails here rather than in front of a student.
 */

const oauthService = require('../services/oauth.service');
const { oauthFailureQuery } = require('../controllers/auth.controller');
const { EmailDomainRejectedError } = require('../services/googleIdentity.service');
const { NATIVE_OAUTH_RETURN_BASES } = require('../utils/constants');

const BASE = NATIVE_OAUTH_RETURN_BASES[0];

/** Every failure the browser sign-in path can produce. */
const FAILURES = [
  ['a rejected university domain', new EmailDomainRejectedError('nope', 'gmail.com')],
  ['a rejected domain with no domain recorded', new EmailDomainRejectedError('nope', '')],
  ['an account with no email', new Error('Google returned no email')],
  ['any other failure', new Error('boom')],
  ['no error object at all', null],
];

describe('native return: everything the emitter produces must survive the parser', () => {
  FAILURES.forEach(([label, err]) => {
    it(`round-trips ${label}`, () => {
      const query = oauthFailureQuery(err);
      // redirectAfterOAuth appends the emitter's query to the return base.
      const target = `${BASE}${query}`;
      const parsed = oauthService.parseNativeReturnTarget(target);
      expect(parsed).not.toBeNull();
    });
  });

  it('carries the rejected domain all the way through, so the app can name it', () => {
    const query = oauthFailureQuery(new EmailDomainRejectedError('nope', 'gmail.com'));
    const parsed = oauthService.parseNativeReturnTarget(`${BASE}${query}`);
    expect(parsed).not.toBeNull();
    const rebuilt = oauthService.nativeReturnUrl(parsed);
    expect(rebuilt).toContain('error=domain');
    expect(rebuilt).toContain('gmail.com');
  });

  it('still rejects a parameter neither side knows about', () => {
    expect(oauthService.parseNativeReturnTarget(`${BASE}?error=domain&state=x`)).toBeNull();
  });

  it('rejects a domain value that is not a hostname', () => {
    expect(oauthService.parseNativeReturnTarget(`${BASE}?error=domain&domain=<script>`)).toBeNull();
    expect(oauthService.parseNativeReturnTarget(`${BASE}?error=domain&domain=${'a'.repeat(300)}`)).toBeNull();
  });

  it('rejects a domain sent without the error it belongs to', () => {
    expect(oauthService.parseNativeReturnTarget(`${BASE}?domain=gmail.com`)).toBeNull();
  });
});
