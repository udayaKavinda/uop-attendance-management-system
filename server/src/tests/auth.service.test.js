/**
 * Authorization logic unit tests (pure role checks, no DB).
 */
const authService = require('../services/auth.service');

describe('getPersonFromRequest', () => {
  it('rejects when not authenticated', () => {
    const req = { isAuthenticated: () => false };
    const r = authService.getPersonFromRequest(req);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it('rejects when isAuthenticated is missing', () => {
    const r = authService.getPersonFromRequest({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it('rejects when authenticated but no user', () => {
    const req = { isAuthenticated: () => true, user: null };
    const r = authService.getPersonFromRequest(req);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it('accepts an authenticated user', () => {
    const person = { _id: '1', role: 'student' };
    const req = { isAuthenticated: () => true, user: person };
    const r = authService.getPersonFromRequest(req);
    expect(r.ok).toBe(true);
    expect(r.person).toBe(person);
  });
});

describe('authorizeStaff', () => {
  it('allows admin', () => {
    const r = authService.authorizeStaff({ role: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.isAdmin).toBe(true);
  });
  it('allows active lecturer', () => {
    const r = authService.authorizeStaff({ role: 'lecturer', deleted: false });
    expect(r.ok).toBe(true);
    expect(r.isAdmin).toBe(false);
  });
  it('rejects deleted lecturer', () => {
    const r = authService.authorizeStaff({ role: 'lecturer', deleted: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
  it('rejects student', () => {
    const r = authService.authorizeStaff({ role: 'student' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
  it('treats missing role as student', () => {
    expect(authService.authorizeStaff({}).ok).toBe(false);
  });
});

describe('authorizeAdmin', () => {
  it('allows admin', () => {
    expect(authService.authorizeAdmin({ role: 'admin' }).ok).toBe(true);
  });
  it('rejects lecturer', () => {
    const r = authService.authorizeAdmin({ role: 'lecturer', deleted: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe('authorizeStudent', () => {
  it('allows active student', () => {
    expect(authService.authorizeStudent({ role: 'student', deleted: false }).ok).toBe(true);
  });
  it('rejects deleted student', () => {
    const r = authService.authorizeStudent({ role: 'student', deleted: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
  it('rejects non-student roles', () => {
    expect(authService.authorizeStudent({ role: 'lecturer' }).ok).toBe(false);
    expect(authService.authorizeStudent({ role: 'admin' }).ok).toBe(false);
  });
});
