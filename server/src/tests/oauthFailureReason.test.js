'use strict';

/**
 * Browser sign-in can only report its outcome through the redirect URL, so this
 * mapper decides what the user is told. It used to be a constant `?error=auth`,
 * which both clients rendered as "Sign-in failed. Please try again." — wrong for
 * a rejected email domain, where retrying can never work.
 *
 * The codes here are the contract with web/src/hooks/useSession.ts
 * (signInFailureMessage) and Android's oauthReturnFrom().
 */

jest.mock('passport', () => ({ authenticate: jest.fn(), serializeUser: jest.fn(), deserializeUser: jest.fn() }));

const { oauthFailureQuery } = require('../controllers/auth.controller');
const { EmailDomainRejectedError } = require('../services/googleIdentity.service');

describe('oauthFailureQuery', () => {
  test('a domain rejection reports the code and names the configured domain', () => {
    const err = new EmailDomainRejectedError('Only @eng.pdn.ac.lk ...', 'eng.pdn.ac.lk');
    expect(oauthFailureQuery(err)).toBe('/?error=domain&domain=eng.pdn.ac.lk');
  });

  test('a domain rejection still reports the code when the domain is unusable', () => {
    for (const bad of [undefined, '', 'not a domain', 'javascript:alert(1)', '../../etc', 'a..b']) {
      expect(oauthFailureQuery(new EmailDomainRejectedError('x', bad))).toBe('/?error=domain');
    }
  });

  test('a profile with no email gets its own code', () => {
    expect(oauthFailureQuery(new Error('No email in Google profile'))).toBe('/?error=no_email');
  });

  test('anything else falls back to the generic code', () => {
    expect(oauthFailureQuery(new Error('ECONNRESET talking to accounts.google.com'))).toBe('/?error=auth');
    expect(oauthFailureQuery(null)).toBe('/?error=auth');
    expect(oauthFailureQuery(undefined)).toBe('/?error=auth');
  });

  test('never puts the raw error message in the URL', () => {
    const leaky = new Error('MongoServerError: connection <secret> refused');
    expect(oauthFailureQuery(leaky)).not.toMatch(/secret|Mongo/);
  });
});
