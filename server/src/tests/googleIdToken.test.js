'use strict';

// Mock connect-mongo before the app is loaded (MongoStore.create runs at module load).
// Uses express-session's own MemoryStore rather than a hand-rolled stub, so the
// store inherits the full Store base class (`regenerate`, `load`, `createSession`)
// that Passport's req.logIn() relies on when it rotates the session id.
jest.mock('connect-mongo', () => {
  const expressSession = require('express-session');
  return {
    MongoStore: {
      create: jest.fn(() => new expressSession.MemoryStore()),
    },
  };
});

// Google's verifier is mocked so the suite never makes a network call.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

// Person is mocked so the suite needs no MongoDB.
jest.mock('../models/Person', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));

// So is the settings singleton. upsertGooglePerson reads it to apply the
// student email-domain rule, and only on the branch that creates a brand-new
// Person — so without this mock the two tests that create an account were the
// only ones that touched a real Mongoose model. With no connection those queries
// sit in Mongoose's buffer for its 10s default, which is exactly Jest's own
// timeout, so both failed as "Exceeded timeout" rather than as an assertion.
jest.mock('../services/settings.service', () => ({
  getSettings: jest.fn().mockResolvedValue({ studentEmailDomain: 'eng.pdn.ac.lk' }),
  isBleEnabled: jest.fn().mockResolvedValue(true),
  buffers: jest.fn(() => ({ nearBufferM: 50, farBufferM: 100 })),
}));

process.env.GOOGLE_CLIENT_ID = 'test-web-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../app');
const Person = require('../models/Person');

const JWT = 'aaa.bbb.ccc';

function payload(overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    sub: 'google-sub-123',
    email: 'student@eng.pdn.ac.lk',
    email_verified: true,
    ...overrides,
  };
}

/** Fetches a real nonce from the server so the token can carry a valid one. */
async function freshNonce() {
  const res = await request(app)
    .get('/api/auth/google-nonce')
    .set('X-Requested-With', 'test');
  return res.body.nonce;
}

beforeEach(() => {
  jest.clearAllMocks();
  Person.findOne.mockResolvedValue(null);
  Person.create.mockImplementation(async (doc) => ({
    _id: 'person-1',
    role: 'student',
    active: true,
    deleted: false,
    save: jest.fn(),
    ...doc,
  }));
});

describe('GET /api/auth/google-nonce', () => {
  test('returns a single-use nonce', async () => {
    const res = await request(app).get('/api/auth/google-nonce');
    expect(res.status).toBe(200);
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(16);
  });

  test('two calls return different nonces', async () => {
    const a = await freshNonce();
    const b = await freshNonce();
    expect(a).not.toBe(b);
  });
});

describe('POST /api/auth/google-id-token', () => {
  test('rejects a missing token', async () => {
    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing idToken/);
  });

  test('rejects a malformed token without calling Google', async () => {
    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: 'not-a-jwt' });
    expect(res.status).toBe(400);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  test('is protected by the CSRF guard (no X-Requested-With)', async () => {
    const res = await request(app)
      .post('/api/auth/google-id-token')
      .send({ idToken: JWT });
    expect(res.status).toBe(403);
  });

  test('rejects a token Google refuses to verify', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));
    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid Google token');
  });

  test('rejects a token whose nonce was never issued (replay/forgery)', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => payload({ nonce: 'never-issued-nonce' }),
    });
    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Sign-in expired/);
  });

  test('rejects a token with no nonce at all', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });
    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });
    expect(res.status).toBe(401);
  });

  test('rejects an unverified Google email', async () => {
    const nonce = await freshNonce();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => payload({ nonce, email_verified: false }),
    });
    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not verified/);
  });

  test('accepts a valid token, creates the Person and opens a session', async () => {
    const nonce = await freshNonce();
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload({ nonce }) });

    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Audience must be checked against our own client id.
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: JWT,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    // New account is created with Google's subject as studentId — the same value
    // the Custom Tab flow stores, so the two paths share one Person.
    expect(Person.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'student@eng.pdn.ac.lk', studentId: 'google-sub-123', role: 'student' }),
    );
    // The session cookie is set on THIS response, which is what the app's cookie jar stores.
    expect(String(res.headers['set-cookie'] || '')).toMatch(/attendance\.sid/);
  });

  test('a nonce cannot be used twice', async () => {
    const nonce = await freshNonce();
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload({ nonce }) });

    const first = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });
    expect(replay.status).toBe(401);
  });

  test('normalises email case and reuses an existing Person', async () => {
    const nonce = await freshNonce();
    const existing = {
      _id: 'person-existing',
      email: 'student@eng.pdn.ac.lk',
      studentId: 'google-sub-123',
      role: 'lecturer',
      active: true,
      deleted: false,
      save: jest.fn(),
    };
    Person.findOne.mockResolvedValue(existing);
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => payload({ nonce, email: 'Student@Eng.Pdn.Ac.LK' }),
    });

    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });

    expect(res.status).toBe(200);
    expect(Person.create).not.toHaveBeenCalled();
    // An active lecturer keeps their role.
    expect(existing.role).toBe('lecturer');
  });

  test('demotes a lecturer whose account is no longer active', async () => {
    const nonce = await freshNonce();
    const revoked = {
      _id: 'person-revoked',
      email: 'old.lecturer@eng.pdn.ac.lk',
      studentId: 'google-sub-123',
      role: 'lecturer',
      active: false,
      deleted: false,
      save: jest.fn(),
    };
    Person.findOne.mockResolvedValue(revoked);
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => payload({ nonce, email: 'old.lecturer@eng.pdn.ac.lk' }),
    });

    const res = await request(app)
      .post('/api/auth/google-id-token')
      .set('X-Requested-With', 'test')
      .send({ idToken: JWT });

    expect(res.status).toBe(200);
    expect(revoked.role).toBe('student');
  });
});
