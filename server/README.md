# UOP Attendance Management System — Server

Express.js + MongoDB backend for a university lecture-attendance platform. The production
clients are **native mobile apps** (Android in this repo); there is no web SPA checked in
here. Students sign in with Google, see which of their courses have a lecture running
*right now*, and record attendance over a rotating-token Bluetooth (BLE) handshake.
Lecturers and admins manage courses, lecture sessions, the BLE broadcast, and attendance
reporting.

The server is an **application factory** (`app.js`) with a clean layered architecture
(routes → controllers → services → models) and no business logic in routes.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Data Models](#data-models)
- [Authentication & Authorization](#authentication--authorization)
- [Security](#security)
- [API Reference](#api-reference)
- [Bluetooth Attendance Flow](#bluetooth-attendance-flow)
- [Background Jobs](#background-jobs)
- [Caching](#caching)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Production Notes](#production-notes)

---

## Tech Stack

| Concern         | Library                              |
|-----------------|--------------------------------------|
| HTTP framework  | `express` ^5                         |
| Database / ODM  | `mongoose` ^9 (MongoDB)              |
| Auth            | `passport` + `passport-google-oauth20` |
| Google ID tokens| `google-auth-library` (Credential Manager sign-in) |
| Sessions        | `express-session` + `connect-mongo`  |
| Security headers| `helmet`                             |
| CORS            | `cors`                               |
| Rate limiting   | `express-rate-limit`                 |
| Config          | `dotenv`                             |
| Testing         | `jest` + `supertest`                 |

---

## Architecture

```
HTTP request
   │
   ▼
helmet (CSP/HSTS) ──► CORS ──► express.json (256kb) ──► session ──► passport
   │
   ▼
[test-only] testAuth shim (NODE_ENV=test)
   │
   ▼
csrf (X-Requested-With check on mutating /api/* calls)
   │
   ▼
Router ──► requireAuth guard ──► (requireCourseAccess / requireSessionAccess)
   │
   ▼
Controller (HTTP only) ──► Service (business logic) ──► Model (Mongoose)
   │
   ▼
centralized errorHandler (4-arg)
```

**Layer responsibilities**

- **Routes** — wire paths to middleware + controller, nothing else.
- **Controllers** — parse/validate input, call a service, shape the HTTP response.
- **Services** — all business logic and DB access; return plain `{ ok, ... }` result objects.
- **Validators** — pure input validation, return `{ ok, status, error, ...cleaned }`.
- **Middlewares** — auth guards, CSRF, async wrapper, error handler.
- **Models** — Mongoose schemas + indexes.
- **Utils** — pure helpers (dates, schedule math, regex escaping, label formatting).

`server.js` is the process entry point (connect DB, sync indexes, bootstrap admin, start
jobs, listen, graceful shutdown). `app.js` builds the Express app **without** connecting to
the DB or listening, so it is safe to import directly in tests via `supertest`.

---

## Directory Structure

```
server/src/
├── app.js                  # Express app factory (no DB/listen)
├── server.js               # Process entry: connect, jobs, listen, shutdown
├── config/
│   ├── env.js              # Loads .env, validates secrets, exports config
│   ├── database.js         # connect/sync-indexes/close + connection events
│   ├── security.js         # Helmet CSP + HSTS
│   ├── cors.js             # CORS allowlist (FRONTEND_URL/APP_BASE_URL + Capacitor)
│   ├── session.js          # express-session backed by MongoStore
│   ├── passport.js         # Google OAuth strategy + (de)serialize
│   ├── rateLimit.js        # studentRecordLimiter, oauthLimiter
│   └── index.js            # Re-exports applySecurity/applyCors/applySession/applyPassport
├── middlewares/
│   ├── asyncHandler.js     # Wraps async handlers so rejections reach errorHandler
│   ├── requireAuth.js      # requireStaff/Admin/Student/AnyAuth + course/session guards
│   ├── errorHandler.js     # Mongo-aware central error handler
│   ├── csrf.js             # X-Requested-With enforcement
│   ├── testAuth.js         # Test-only auth shim (NODE_ENV=test)
│   └── index.js
├── models/                 # Person, Course, LectureSession, Attendance, BleToken
├── controllers/            # auth, courses, attendance, bluetooth, health, pages, admin/*
├── services/               # auth, course, lectureSession, attendance, session,
│                           # oauth, googleIdentity, bluetoothCode, lecturer,
│                           # bootstrap, sessionExpiry
├── routes/                 # auth, courses, attendance, bluetooth, health, pages, admin/*
├── validators/             # attendance, course, session, lecturer, oauth
├── utils/                  # constants, schedule, date, regex, attendanceLabels, lecturerIds
└── tests/                  # jest suites (ble.routes, bluetoothCode, schedule, auth.service, session.window, pages.routes)
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB (local `mongodb://localhost:27017/attendance` or a connection string)
- Google OAuth 2.0 credentials (Client ID + Secret) for sign-in

### Install & Run

```bash
# from the server/ folder
npm install
cp ../.env.example .env    # .env.example lives at the repo root; fill in values

# run the server
npm start

# run server tests
npm test
```

The server listens on `PORT` (default **5000**).

---

## Environment Variables

Defined / consumed in `config/env.js`, `config/cors.js`, `config/passport.js`,
`config/security.js`.

| Variable                  | Required          | Default                              | Purpose |
|---------------------------|-------------------|--------------------------------------|---------|
| `NODE_ENV`                | recommended       | `development`                        | `production` enables CSP enforcement, secure cookies, HSTS, and fail-fast secret checks. |
| `PORT`                    | no                | `5000`                               | HTTP listen port. |
| `MONGO_URI`               | no (prod: yes)    | `mongodb://localhost:27017/attendance` | MongoDB connection string. |
| `SESSION_SECRET`          | **prod: yes**     | `dev-only-secret` (dev only)         | Session cookie signing secret. Server **exits** if unset in production. |
| `BLE_SECRET`              | **prod: yes**     | `uop-ble-dev-secret-change-me` (dev) | Required in production (fail-fast). Rotating BLE tokens are random values stored in `BleToken`; this env var is reserved for future signing — not used by `bluetoothCode.service.js` today. |
| `GOOGLE_CLIENT_ID`        | **yes**           | —                                    | The **Web** OAuth client id. Used twice: the OAuth flow, and as the **audience** when verifying Credential Manager ID tokens. Must equal the app's `GOOGLE_WEB_CLIENT_ID` or every native sign-in fails with `Invalid Google token`. If missing, `/auth/google` and `/api/auth/google-nonce` return 503. |
| `GOOGLE_CLIENT_SECRET`    | for OAuth         | —                                    | Google OAuth client secret. Needed only for the Custom Tab fallback — ID-token verification does not use it. |
| `APP_BASE_URL`            | for OAuth         | —                                    | Public base URL of the server; used to build the OAuth callback URL. |
| `FRONTEND_URL`            | yes               | `http://localhost:3000`              | Comma-separated allowed origins (CORS + OAuth return). First entry is the default redirect target. |
| `REACT_APP_API_BASE`      | no                | —                                    | Legacy/optional. Used only as a last-resort fallback for the OAuth callback base in `config/passport.js` when `APP_BASE_URL` and `FRONTEND_URL` are both unset. There is **no web frontend** in this repo — the only client is the native Android app. |
| `CSP_EXTRA_CONNECT_SRC`   | no                | —                                    | Comma-separated extra `connect-src` origins for CSP. |
| `CSP_REPORT_ONLY`         | no                | `false`                              | `1`/`true` puts production CSP in report-only mode. |
| `SESSION_EXPIRE_JOB_MS`   | no                | `60000` (min `10000`)                | Interval for the non-recurring session expiry job. |
| `BOOTSTRAP_ADMIN_EMAIL`   | see note          | (hardcoded constant)                 | Email auto-promoted to admin on startup. *Currently a constant in `utils/constants.js` — move to env for real deployments.* |
| `TZ`                      | **required (prod)** | system                             | **Functionally required.** `attendanceDate` and the schedule-window checks use the server's *local* time, so a server running in UTC (e.g. a default container) computes the wrong calendar day near local midnight — shifting the attendance unique key and the "running now" day. Set to the institution's zone, e.g. `Asia/Colombo`. |

---

## Data Models

### Person (`people` collection)
All users — students, lecturers, admins — share one collection.

| Field      | Type    | Notes |
|------------|---------|-------|
| `email`    | String  | unique, required |
| `studentId`| String  | unique, required (Google subject, or synthetic `dir:` id for directory-only lecturers) |
| `role`     | enum    | `student` \| `admin` \| `lecturer` (default `student`) |
| `name`     | String  | display name |
| `phone`    | String  | optional |
| `active`   | Boolean | default `true` |
| `deleted`  | Boolean | soft-delete flag |

Index: `{ role, deleted }`.

### Course
| Field      | Type      | Notes |
|------------|-----------|-------|
| `name`     | String    | required |
| `code`     | String    | required, uppercased |
| `batch`    | String    | required |
| `lecturers`| [ObjectId]| 1–5 unique Person refs (schema-validated) |
| `active`   | Boolean   | indexed |

Indexes: unique `{ code, batch }`, `{ code }`, `{ lecturers }`.

### LectureSession
| Field                 | Type    | Notes |
|-----------------------|---------|-------|
| `course`              | ObjectId| ref Course, indexed |
| `lectureDay`          | enum    | `MON`..`SUN` |
| `startTime`/`endTime` | String  | `HH:mm` |
| `recurring`           | Boolean | weekly repeat (default `true`) |
| `broadcasting`        | Boolean | single BLE attendance switch — attendance is open iff `true` (replaces the old `bluetoothEnabled` + `attendancePaused` pair; migrated automatically on startup) |
| `lastBroadcastSeenAt` | Date    | heartbeat — stamped on every broadcast-token poll (~5s) |
| `bluetoothDeviceName` | String  | advertised name (`UOP-XXXXXXXX`) |
| `active`/`deleted`    | Boolean | indexed |

Index: `{ course, lectureDay, startTime, endTime }`.

### Attendance
| Field            | Type    | Notes |
|------------------|---------|-------|
| `student`        | ObjectId| ref Person |
| `course`         | ObjectId| ref Course, indexed |
| `session`        | ObjectId| ref LectureSession, indexed |
| `courseCode`     | String  | denormalized course code |
| `lectureCode`    | String  | denormalized lecture-occurrence label, e.g. `"MON 08:00-10:00"` |
| `attendanceDate` | String  | `YYYY-MM-DD` (local), indexed |
| `timestamp`      | Date    | default now |
| `method`         | enum    | `bluetooth` (only supported method) |

Unique index: `{ student, session, attendanceDate }` — **one record per student per session per day**.

### BleToken
| Field         | Type    | Notes |
|---------------|---------|-------|
| `sessionId`   | String  | unique, indexed |
| `token`       | String  | current 16-char hex token |
| `prevToken`   | String  | previous token (grace-window replay) |
| `generatedAt` | Number  | epoch ms of last rotation |
| `updatedAt`   | Date    | TTL anchor |

TTL index: auto-delete 3600s after `updatedAt` (safety cleanup).

---

## Authentication & Authorization

Two sign-in paths converge on the **same Passport session**. Whichever is used, the
server ends with `req.logIn(person)`, sets `attendance.sid`, and every guard, route and
role check downstream behaves identically.

### Path A — Google ID token (Credential Manager) — primary

The Android app obtains a Google ID token natively (no browser) and posts it here.

1. `GET /api/auth/google-nonce` issues a single-use nonce (32-byte random, 5-minute TTL).
2. The app passes it to Credential Manager; Google embeds it in the ID token.
3. `POST /api/auth/google-id-token` verifies the token with `google-auth-library`:
   signature, **audience == `GOOGLE_CLIENT_ID`**, issuer, expiry — then requires
   `email_verified` and consumes the nonce (single use, so a replayed token is rejected).
4. `upsertGooglePerson()` resolves the `Person`, then `req.logIn()` opens the session.

Only `GOOGLE_CLIENT_ID` is needed to verify — the client *secret* is not used on this path.

### Path B — Google OAuth 2.0 via Custom Tab — fallback

Kept for devices without Google Play services / a Google account, and for
already-installed older app versions.

1. Client hits `GET /auth/google?returnTo=<native-scheme>` → redirect to Google with
   `prompt=select_account`.
2. Google redirects back to `GET /auth/google/callback`.
3. Passport's verify callback calls the same `upsertGooglePerson()`.
4. Passport serializes `user._id` into the session; `deserializeUser` loads the `Person`.

Native logins (`lk.ac.pdn.eng.attendance://oauth` or legacy `lk.uop.attendance://oauth`,
both in `NATIVE_OAUTH_RETURN_BASES`) bounce through `/auth/native-return` and use a
one-time **exchange code** (32-byte random, 2-minute TTL) consumed at
`POST /api/auth/exchange-code`.

### Shared Person resolution

`services/googleIdentity.service.js` owns `upsertGooglePerson({ email, googleSub })`, used
by **both** paths so they can never drift:

- On first login a `Person` (role `student`) is created from the Google identity.
- `studentId` stores Google's stable subject — the ID token's `sub` equals Passport's
  `profile.id`, so an account created on one path is found (not duplicated) on the other.
- Email is matched case-insensitively and normalised to lower case.
- Synthetic ids (`dir:`, `dir-`, `pending:`) are upgraded to the real Google subject.
- If a matching active **lecturer** record exists for that email, the role is honored;
  a lecturer whose account is no longer active is demoted to `student`.
- The Google profile **name is deliberately not written** — lecturer display names are
  curated by admins and must not be overwritten at sign-in.

### Authorization guards (`middlewares/requireAuth.js`)
| Guard                 | Allows |
|-----------------------|--------|
| `requireAnyAuth`      | any authenticated user |
| `requireStudent`      | role `student`, not deleted |
| `requireStaff`        | role `admin` or active `lecturer` |
| `requireAdmin`        | role `admin` |
| `requireCourseAccess(param)` | staff assigned to the course (or admin); loads `req.course` |
| `requireSessionAccess(opts)` | course access for the session's course; loads `req.sessionItem` |

Guards attach `req.auth = { person, isAdmin? }`. Authorization derives entirely from the
Passport session — never from client headers.

---

## Security

- **Helmet CSP** — enforced in production, **report-only in development** (so policy
  regressions surface in logs without blocking local work). Allowlist for self, Google
  Fonts, Google OAuth form-action; `frame-ancestors 'none'`.
- **HSTS** — enabled in production (`max-age=31536000; includeSubDomains; preload`).
- **CSRF** — mutating `/api/*` requests must send `X-Requested-With`. Form-based cross-site
  POSTs cannot set this header, neutralizing CSRF against `SameSite=None` session cookies.
- **Sessions** — `httpOnly` cookies; `Secure` + `SameSite=None` in production (`Lax` in dev).
  The only client is the native Android app, whose OkHttp stack ignores `SameSite` entirely,
  so the value has no functional effect here — `SameSite=Lax` would be the tighter default.
  Stored in MongoDB with a 7-day TTL and 1-hour touch throttle. The session store reuses the
  Mongoose connection (single connection pool).
- **Rate limiting** — `studentRecordLimiter` (60/min, keyed by user id or IP) on attendance
  recording; `oauthLimiter` (20/min) on OAuth endpoints, including the nonce and
  ID-token routes (two calls per sign-in → ~10 attempts/min).
- **ID token verification** — signature, audience (`GOOGLE_CLIENT_ID`), issuer and expiry
  are checked by `google-auth-library`; `email_verified` is required; a single-use nonce
  blocks replay of a captured token. Tokens are never trusted by decoding alone.
- **Request body cap** — `express.json({ limit: '256kb' })`.
- **Fail-fast secrets** — production exits if `SESSION_SECRET` or `BLE_SECRET` is unset.
- **Regex injection** — user search input is escaped (`utils/regex.js`) before building queries.

---

## API Reference

Base paths: OAuth browser routes under `/auth`, everything else under `/api`.
All error responses are `{ "error": "<message>" }`. Mutating `/api/*` calls require the
`X-Requested-With` header.

### Health
| Method | Path           | Auth | Description |
|--------|----------------|------|-------------|
| GET    | `/api/healthz` | none | `200` `{ status:"ok", mongo, uptime, memory, version }`; `503` when MongoDB is down. |

### Pages
Plain HTML, mounted at `/` (not `/api`), no auth, no CSRF guard. Required for Google
Play's privacy-policy and account-deletion listing requirements.

| Method | Path       | Auth | Description |
|--------|------------|------|-------------|
| GET    | `/privacy` | none | Privacy policy page. |
| GET    | `/delete`  | none | Account-deletion instructions (email-based request). |

### Auth / Session
| Method | Path                      | Auth          | Description |
|--------|---------------------------|---------------|-------------|
| GET    | `/api/auth/google-nonce`    | none        | Single-use nonce (5-min TTL) for Credential Manager sign-in. `503` if `GOOGLE_CLIENT_ID` is unset. *rate-limited.* |
| POST   | `/api/auth/google-id-token` | none (token)| Verify a Google ID token → establishes a session. Body `{ idToken }`. `400` malformed, `401` invalid/replayed nonce, `403` unverified email. *rate-limited.* |
| GET    | `/auth/google`            | none          | Start Google OAuth (saves `returnTo`, adds `prompt=select_account`). 503 if OAuth not configured. |
| GET    | `/auth/google/callback`   | none          | OAuth callback; logs in and redirects. |
| GET    | `/auth/native-return`     | none          | HTML deep-link bounce for native apps (validates `target`); sends a route-scoped CSP so the inline redirect runs. |
| POST   | `/api/auth/exchange-code` | none (code)   | Consume a one-time native exchange code → establishes a session. |
| GET    | `/api/me`                 | any           | `{ studentId, email, role, lecturerId }`. |

> **Identifier convention:** in API responses (`/api/me`, `attendance-status`) the
> `studentId`/`lecturerId` fields carry the Person **`_id`** — the canonical identity the
> frontend keys on. The model's own `Person.studentId` (Google subject) is internal and not
> exposed. The attendance matrix uses a separate `displayId` (email local-part) for its
> human-readable export column, so `studentId` never means two different things.
> `lecturerId` is populated only when `role` is `lecturer`; it is `null` for students and admins.
| POST   | `/api/logout`             | any           | Ends the session. |

### Student
| Method | Path                                   | Auth     | Description |
|--------|----------------------------------------|----------|-------------|
| GET    | `/api/courses`                         | any auth | Active courses (id, code, batch, name). |
| GET    | `/api/courses/running`                 | any auth | Courses with a session running now. |
| GET    | `/api/attendance-status?courseId=`     | student  | Whether the student is marked today for this course. Uses the live session when one is running; otherwise falls back to any record made earlier today, so it still confirms attendance after the lecture window closes. |
| GET    | `/api/bluetooth-target?courseId=`      | student  | BLE device name for the active session. Errors with "Attendance is not open…" unless the broadcast is live (broadcasting + fresh heartbeat). |
| POST   | `/api/bluetooth-attendance`            | student* | Record attendance via BLE token. *rate-limited.* Body: `{ courseId, token }`. |

### Admin / Staff — Courses (`/api/admin/courses`)
| Method | Path                                | Auth  | Description |
|--------|-------------------------------------|-------|-------------|
| GET    | `/`                                 | staff | Courses visible to the caller (admin: all). |
| POST   | `/`                                 | staff | Create a course (admin assigns lecturers; lecturer self-assigns). |
| PATCH  | `/:courseId/assign-lecturer`        | admin | Replace the lecturer set (1–5). |
| DELETE | `/:courseId`                        | staff + course access | Delete course (cascades sessions, attendance, BLE tokens). |
| PATCH  | `/:courseId/disable`                | staff + course access | Disable course (deactivates its sessions). Returns `{ success, course }` with populated `lecturers`. |
| PATCH  | `/:courseId/enable`                 | staff + course access | Enable course. Returns `{ success, course }` with populated `lecturers`. |
| GET    | `/:courseId/sessions`               | staff + course access | List the course's sessions. |
| POST   | `/:courseId/sessions`               | staff + course access | Create a session (validates overlap; `409` if course disabled). |
| GET    | `/:courseId/attendance-matrix`      | staff + course access | Student × session attendance grid for export. Rows expose `displayId` (email local-part, for the export column) and `email`; only sessions with at least one record appear as columns. |

### Admin / Staff — Sessions (`/api/admin/sessions`)
| Method | Path                                  | Auth  | Description |
|--------|---------------------------------------|-------|-------------|
| GET    | `/`                                   | staff | All sessions in scope. |
| GET    | `/running`                            | staff | Sessions running now (with `broadcasting` status). |
| DELETE | `/:sessionId`                         | staff + session access | Soft-delete a session (turns broadcast off, removes token). |
| PATCH  | `/:sessionId/activate`                | staff + session access | Activate (fails if course disabled). |
| PATCH  | `/:sessionId/deactivate`              | staff + session access | Deactivate (turns broadcast off, removes token). |
| PATCH  | `/:sessionId/broadcast`               | staff + session access | Single broadcast switch. Body `{ on: boolean }`. **On** requires an active session, enabled course, and the current time inside the session's schedule window; seeds device name + token. **Off** is unconditional. |
| GET    | `/:sessionId/broadcast`               | staff + session access | Current token + `rotatesIn`/`rotationMs`, plus `attendanceCount` (today's marked count for this session) and `minutesRemaining` (time left in the schedule window) — the Android app surfaces these two in its foreground-service notification and dashboard card instead of the raw token. Each poll stamps the **heartbeat**; `400` when off or outside the schedule window (poll auto-closes the broadcast). |
| GET    | `/:sessionId/attendance`              | staff + session access | Attendance records for the session. |

### Admin — Lecturers (`/api/admin/lecturers`)
| Method | Path        | Auth  | Description |
|--------|-------------|-------|-------------|
| GET    | `/?q=`      | admin | Search lecturers by name/email/phone (used by the Android admin Courses filter and Owners dialog). |
| POST   | `/`         | admin | Create or upsert a lecturer. |
| PATCH  | `/:id`      | admin | Update name/phone/email/active. |
| DELETE | `/:id`      | admin | Soft-delete; reassigns courses that would be left lecturer-less. |

---

## Bluetooth Attendance Flow

Token logic lives in `services/bluetoothCode.service.js`.

- **Rotation:** `ROTATION_MS = 15000` (15s). Each rotation moves the current token to
  `prevToken` and mints a new 16-char hex token.
- **Grace window:** `GRACE_MS = 2000` — the previous token is accepted for 2s after a
  rotation boundary so a student who scanned just before rotation still succeeds.
- Tokens persist in the `BleToken` collection (survive restarts) and auto-expire via a
  1-hour TTL index.
- **Schedule window:** `PATCH …/broadcast {on:true}` and `GET …/broadcast` both require
  the session to be active, its course enabled, and the current time inside the
  configured weekly window (same rule as `/running`). A poll outside the window
  auto-closes the broadcast; a background sweep also turns off out-of-window broadcasts.
- **Heartbeat:** the broadcasting phone polls `GET /:id/broadcast` every ~5s; each poll
  stamps `lastBroadcastSeenAt`. A broadcast with no poll for `BROADCAST_STALE_MS` (30s,
  ~6 missed polls) is considered dead: students are rejected at read time immediately,
  and the background sweep flips `broadcasting` off and removes the token. So the server
  never accepts attendance against a dead channel for more than ~30s, even if the
  broadcaster crashed and could not call the off switch.
- **On-air encoding (Android):** the lecturer phone advertises a **non-connectable** BLE
  packet whose service UUID embeds the token (`554f5041-…` / `UOPA` prefix). Student phones
  scan with a service-UUID filter that matches the fixed `UOPA` prefix while masking out the
  rotating token bytes (so the filter still matches as the UUID rotates, and scanning keeps
  delivering results with the screen off), then submit the recovered token over HTTPS.

**Recording (`POST /api/bluetooth-attendance`)** validates, in order:
1. Course resolves to an active session running now.
2. The broadcast is **live**: `broadcasting` is true, the heartbeat is fresh, and the
   session is still inside its schedule window (error: "Attendance is not open for
   this session right now.").
3. Current time is inside the session window.
4. Submitted token verifies (current or grace `prevToken`).
5. Idempotent write — a duplicate (same student/session/day) returns `{ duplicate: true }`
   instead of erroring; the `11000` unique-key race is caught and resolved to the existing row.

---

## Background Jobs

- **Non-recurring session expiry + broadcast sweeps** (`services/sessionExpiry.service.js`)
  — runs at startup and every `SESSION_EXPIRE_JOB_MS` (default 60s, min 10s). Deactivates
  non-recurring sessions whose end time has passed, turns off broadcasts whose heartbeat
  is older than 30s (`BROADCAST_STALE_MS`), and turns off broadcasts that have left their
  schedule window, independent of API traffic.
- **OAuth exchange-code sweep** (`services/oauth.service.js`) — every 5 minutes, purges
  expired native exchange codes. *(In-memory `Map`; single-process only — move to a shared
  store for horizontal scaling.)*
- **Sign-in nonce sweep** (`services/googleIdentity.service.js`) — every 5 minutes, purges
  expired Credential Manager nonces. *(Same in-memory caveat: with more than one instance
  behind a load balancer, a nonce issued by one process is unknown to another and sign-in
  fails intermittently — move to Redis before scaling out.)*

---

## Caching

`services/session.service.js` keeps a **5-second in-memory cache**
(`SESSION_RESOLVE_CACHE_TTL_MS`) of "active session for course X right now" to absorb
heavy student polling. The cache is **explicitly invalidated** via
`invalidateActiveSessionCache(courseId)` whenever relevant state changes — session
activate/deactivate/delete, broadcast on/off (including the stale-broadcast sweep), and
course enable/disable/delete — so toggles take effect immediately.

> The cache is per-process. Under horizontal scaling, move it (and the OAuth exchange-code
> store) to Redis.

---

## Error Handling

`middlewares/errorHandler.js` is the single 4-arg Express error handler. `respondError`
classifies common Mongoose errors so client mistakes don't surface as 500s and driver
internals don't leak:

| Condition                        | Status | Body |
|----------------------------------|--------|------|
| `CastError`                      | 400    | `Invalid identifier` |
| `ValidationError`                | 400    | `Invalid input` |
| Duplicate key (`11000`/`11001`)  | 409    | `Duplicate value` |
| Anything else                    | 500    | `Internal server error` (prod) / `err.message` (dev) |

Async route handlers are wrapped with `asyncHandler` so rejected promises reach this handler
instead of hanging the request.

---

## Testing

Jest config lives in `server/package.json` (Node env, 10s timeout, `src/tests/**/*.test.js`).

```bash
# from the server/ folder
npm test
```

Suites:
- `ble.routes.test.js` — broadcast on/off toggle, token poll + heartbeat, target/record,
  staleness rejection, auth + validation paths.
- `bluetoothCode.test.js` — token generation, rotation, grace window, verification, removal.
- `schedule.test.js` — `toMinutes`, overlap detection, non-recurring expiry.
- `auth.service.test.js` — role authorization (`getPersonFromRequest`, staff/admin/student).
- `session.window.test.js` — schedule-window resolution + cache-invalidation helper.
- `googleIdToken.test.js` — Credential Manager sign-in: nonce issue/single-use, audience
  check, CSRF guard, malformed/rejected tokens, unverified email, replay rejection,
  Person create/reuse and lecturer demotion. Google's verifier and `Person` are mocked,
  so it needs neither network nor MongoDB.
- `pages.routes.test.js` — `/privacy` and `/delete` return 200 HTML and cross-link each
  other; confirms neither route is gated by the CSRF middleware.

Tests use the `testAuth` shim: when `NODE_ENV=test`, an `x-test-user` JSON header injects
`req.user`, so authenticated requests can be simulated without mocking Passport.

---

## Production Notes

Before deploying:

1. Set `NODE_ENV=production`.
2. Provide strong `SESSION_SECRET` and `BLE_SECRET` (the server refuses to start otherwise).
3. Use an authenticated `MONGO_URI` (not `localhost`).
4. Serve over HTTPS (required for `Secure`/`SameSite=None` cookies and HSTS).
5. Configure `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and a correct `APP_BASE_URL`.
   `GOOGLE_CLIENT_ID` must be the **Web** client id and must match the Android app's
   `GOOGLE_WEB_CLIENT_ID`; also register an **Android** OAuth client (package +
   SHA-1 of every signing key, incl. Play App Signing) or native sign-in fails.
   Run `npm install` after pulling this change — `google-auth-library` is a new dependency.
6. Set `FRONTEND_URL` to the real origin(s); set `TZ` to your institution's timezone.
7. Review `BOOTSTRAP_ADMIN_EMAIL` (currently a constant) so an unintended account isn't
   auto-promoted to admin.

**Operational behavior**
- Graceful shutdown on `SIGTERM`/`SIGINT`: stops accepting connections, closes MongoDB,
  then exits `0`; a 10s watchdog forces exit `0` so process managers don't read a slow
  drain as a crash.
- MongoDB connects with `serverSelectionTimeoutMS: 5000` / `socketTimeoutMS: 45000` and logs
  `disconnected` / `reconnected` / `error` events.
- A failed index sync logs loudly and, in production, exits the process (queries must not
  silently run without their indexes).
- `/api/healthz` returns `503` when MongoDB is disconnected — wire it to your liveness/readiness probe.

**Known scaling limits (single-process state)**
- OAuth exchange codes, Credential Manager sign-in nonces, and the session-resolve cache
  live in-memory; move to Redis before running multiple instances.
- Large reports (`attendance-matrix`, session attendance lists) are unpaginated and built in
  memory — consider aggregation/pagination for very large cohorts.

See also `../Android/README.md` for the native client (OAuth Custom Tab, admin dashboard UX,
BLE scan/broadcast behaviour).
