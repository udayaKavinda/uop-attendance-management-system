'use strict';

jest.mock('connect-mongo', () => ({
  MongoStore: {
    create: jest.fn().mockReturnValue({
      on: jest.fn(),
      get: jest.fn((sid, cb) => cb(null, null)),
      set: jest.fn((sid, s, cb) => cb(null)),
      destroy: jest.fn((sid, cb) => cb(null)),
    }),
  },
}));

jest.mock('../models/Course', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock('../models/Person', () => ({ updateOne: jest.fn().mockResolvedValue({}) }));

const request = require('supertest');
const mongoose = require('mongoose');

const Course = require('../models/Course');
const Person = require('../models/Person');

const app = require('../app');

function makeId() {
  return new mongoose.Types.ObjectId().toHexString();
}

function makePerson(overrides = {}) {
  return { _id: makeId(), email: 'student@example.com', role: 'student', deleted: false, ...overrides };
}

function authHeader(person) {
  return { 'x-test-user': JSON.stringify({ ...person, _id: String(person._id) }) };
}
const csrfHeader = { 'x-requested-with': 'fetch' };
function headers(person) {
  return { ...authHeader(person), ...csrfHeader };
}

beforeEach(() => {
  jest.clearAllMocks();
  Person.updateOne.mockResolvedValue({});
});

describe('GET /api/courses/catalog', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get('/api/courses/catalog');
    expect(res.status).toBe(401);
  });

  test('403 for staff — registration is a student-only concept', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const res = await request(app).get('/api/courses/catalog').set(authHeader(lecturer));
    expect(res.status).toBe(403);
  });

  test('returns only active courses, sorted', async () => {
    const courses = [
      { _id: makeId(), code: 'CO321', name: 'Networks', batch: '2024' },
      { _id: makeId(), code: 'CO101', name: 'Intro', batch: '2024' },
    ];
    Course.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue(courses),
    });
    const student = makePerson();
    const res = await request(app).get('/api/courses/catalog').set(authHeader(student));
    expect(res.status).toBe(200);
    expect(Course.find).toHaveBeenCalledWith({ active: true });
    expect(res.body.items).toHaveLength(2);
  });
});

describe('GET /api/courses/registered', () => {
  test('returns the ids on the session user, coerced to strings', async () => {
    const courseId = makeId();
    const student = makePerson({ registeredCourses: [courseId] });
    const res = await request(app).get('/api/courses/registered').set(authHeader(student));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([courseId]);
  });

  test('empty when the student never registered anything', async () => {
    const student = makePerson();
    const res = await request(app).get('/api/courses/registered').set(authHeader(student));
    expect(res.body.items).toEqual([]);
  });
});

describe('POST/DELETE /api/courses/registered/:courseId', () => {
  test('registering a real active course succeeds', async () => {
    const courseId = makeId();
    Course.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: courseId }) });
    const student = makePerson();
    const res = await request(app).post(`/api/courses/registered/${courseId}`).set(headers(student));
    expect(res.status).toBe(200);
    expect(Course.findOne).toHaveBeenCalledWith({ _id: courseId, active: true });
    expect(Person.updateOne).toHaveBeenCalledWith(
      { _id: String(student._id) },
      { $addToSet: { registeredCourses: courseId } },
    );
  });

  test('404 registering an archived or unknown course', async () => {
    Course.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const student = makePerson();
    const res = await request(app).post(`/api/courses/registered/${makeId()}`).set(headers(student));
    expect(res.status).toBe(404);
    expect(Person.updateOne).not.toHaveBeenCalled();
  });

  test('400 on a malformed course id', async () => {
    const student = makePerson();
    const res = await request(app).post('/api/courses/registered/not-an-id').set(headers(student));
    expect(res.status).toBe(400);
  });

  test('unregistering pulls the id, even if it was never registered', async () => {
    const courseId = makeId();
    const student = makePerson();
    const res = await request(app).delete(`/api/courses/registered/${courseId}`).set(headers(student));
    expect(res.status).toBe(200);
    expect(Person.updateOne).toHaveBeenCalledWith(
      { _id: String(student._id) },
      { $pull: { registeredCourses: courseId } },
    );
  });

  test('403 for staff on both verbs', async () => {
    const admin = makePerson({ role: 'admin' });
    const courseId = makeId();
    const postRes = await request(app).post(`/api/courses/registered/${courseId}`).set(headers(admin));
    const delRes = await request(app).delete(`/api/courses/registered/${courseId}`).set(headers(admin));
    expect(postRes.status).toBe(403);
    expect(delRes.status).toBe(403);
  });
});
