# UOP Attendance API

Express 5 and MongoDB API for the native UOP Attendance Android application. This is the
authoritative server reference for the implemented system.

## What the server does

- Google Credential Manager ID-token sign-in with nonce replay protection, gated to an
  admin-configured email domain for brand-new student accounts (existing accounts and
  lecturers/admins provisioned by an admin are never subject to it).
- Browser Google OAuth fallback with a single-use native exchange code.
- Mongo-backed authenticated sessions, role checks, CSRF protection, CORS, Helmet, and
  two-tier attendance rate limits (see "Rate limits" below).
- An append-only audit log of every staff/admin mutation and every rejected
  authentication or authorization attempt (see "Audit log" below).
- A public app-version check the client uses to enforce an admin-set minimum Android
  `versionCode`, blocking outdated installs with a mandatory update prompt.
- Staff course/session administration with lecturer ownership enforcement; any existing
  owner (not just an admin) may add and remove co-owners on their own course, same as an
  admin can on any course.
- One verification model for every session, with selectable per-band geofence logic and
  peer BLE seeding — see "Verification contract" below, which is the specification.
- Active-building geofence administration and system policy settings.

Students see campus-wide sessions that are running now. There is no enrolment data model
in this repository; do not describe these as membership-filtered “their courses.”

## Requirements and startup

- Node.js 20+
- MongoDB
- Production secrets/configuration from the root `README_ENV.md`

```bash
npm ci
npm test -- --runInBand
npm start
```

Default listen address: `PORT=5000`. Schedule dates use `TZ`, defaulting safely to
`Asia/Colombo`.

The server supports only the schema documented here. It does not migrate or repair older
database shapes; recreate or explicitly transform an existing database before upgrading.

## Verification contract

Every session verifies the same way — there is no per-session policy. A student's 90
second window runs Bluetooth and GPS together, and the server bands the result:

| Evidence | Band | Result |
|---|---|---|
| valid live BLE token | `inside` | present |
| within the near buffer (near-buffer logic) | `inside`/`near` | present |
| within the far buffer (far-buffer logic), not the near one | `suspicious` | correct code → present |
| outside the far buffer | `far` | correct code → flagged¹ |
| no usable fix / accuracy above the ceiling | `unknown` | correct code → flagged¹ |

¹ "Flagged" is not a queue — it's an `Attendance` row with `status: 'flagged'` and a
`reason`, visible only in the Excel attendance export (red fill + cell comment). Nobody
approves or rejects it. `suspicious` always passes on a correct code now — there is no
admin switch for it, unlike `far`/`unknown` which never pass. Crucially, `suspicious`,
`far`, and `unknown` all require the student to actually submit the "get help" code to
produce **any** `Attendance` record at all — raw GPS fixes alone never write one for
these three bands, so a student who never falls back to the code leaves no trace, exactly
like one who never checked in.

"Within the near/far buffer" is deliberately not just a fixed distance check — each band
independently runs a selectable strategy (`Settings.nearBufferLogic`/`farBufferLogic`)
against `nearBufferM`/`farBufferM`. See `services/geofenceLogic.service.js`'s
`STRATEGIES` for the full list (accuracy-weighted centroid, any/majority/all points
within, median distance, best-accuracy-fix-only) — near is always evaluated first, and
far only runs if near didn't already pass.

The client is never told its band: `status: "collecting"` covers both "still gathering
fixes" and "gathered enough but not passing", so a modified app cannot learn how far out
it is. See `docs/attendance-verification-design.md` for the full rationale.

`Settings.bleEnabled` is the single global kill switch. Off, it stops lecturer
broadcasts, student scanning, and peer seeding; GPS keeps running, since every session
depends on it.

### GPS validation

- Android streams one precise fix at a time for up to 90 seconds.
- Outliers are dropped against the median; survivors are averaged weighted by 1/accuracy².
  If trimming leaves fewer than 4 trustworthy fixes the attempt reports "not ready" and
  waits for more, rather than banding on fixes it has already judged unreliable.
- A reported accuracy of `0` means "unknown" (Android returns it when `hasAccuracy()` is
  false), not "perfect", and is normalised to a pessimistic 50 m for both centroid
  weighting and best-fix selection.
- If no contributing fix beat 75 m accuracy the attempt bands `unknown` rather than being
  trusted — a ±200 m "fix" near a building must not pass as `near`.
- Intermediate fixes live only in memory for the attempt. Accepted attendance stores the
  centroid, contributing fix count, and distance for audit.
- The band survives the attempt for 10 minutes so a later code submission can be judged
  against it (`services/attemptVerdict.service.js`).

### Bluetooth and peer seeding

- Primary and seeder tokens rotate every 15 seconds with an 8-second previous-token grace.
  The grace must exceed the broadcaster's 5-second poll interval: rotation is lazy (it
  happens on the first poll that finds the token stale, and only that caller gets the new
  value), so with several devices broadcasting one session every other device keeps
  advertising the old token until its own next poll.
- Broadcast state is live only while its staff heartbeat is fresh and its session is in
  the configured window.
- Seeder selection uses capability reported by Android. Seeder leases are checked during
  token verification, not only by the cleanup sweep.
- **Only students who heard the lecturer's own primary token may seed.** A GPS-passed
  student can be up to `nearBufferM` from the building, and a student who heard a seeder
  is already one hop out; letting either re-broadcast would grow the effective radius.
- Ending/deactivating/deleting a session removes its BLE token pool.
- **Multiple staff devices may broadcast the same session simultaneously** (the "Join"
  client action) — the primary token is per-session, not per-device, so every broadcasting
  phone just advertises whatever the server currently hands back, extending physical
  range in a large room. One device's radio failing (or that device stopping) never
  affects the others or the session's `active` state; only the heartbeat-staleness sweep
  or an explicit deactivate ends the channel for everyone.

### One-time sessions

Weekly sessions have `recurring: true`. A one-time session receives an explicit local
`occurrenceDate` (`YYYY-MM-DD`) for the next selected weekday. It cannot run again on a
later week; expired one-time sessions must be recreated.

Times are strictly validated as zero-padded 24-hour `HH:mm` values.

## Data model summary

### Person

`email`, stable external `studentId`, `role` (`student|lecturer|admin`), `name`, `phone`,
`active`, `deleted`, and `registeredCourses` — an optional, student-only list of courses
picked ahead of time so the check-in search surfaces them without typing. Registering is
never required and is **not** an enrolment gate: an empty list only means the picker
behaves as it always did, and `POST /api/attendance` does not consult it.

### Course

`code` (capital letters and numbers only), `name`, `batch` (`E` followed by two digits,
e.g. `E23`), one or more lecturer owners (no upper limit), and `active`. Unique on
`{ code, batch }` — creating a course accepts multiple `batches` at once and makes one
Course document per batch, all sharing the same owners. There is no separate hard delete:
`DELETE`-equivalent behavior is the same as disabling (`active: false`), which hides the
course rather than destroying its data; disabled courses sort after active ones in listings.

### LectureSession

`course`, `lectureDay` (`MON`…`SUN`), `startTime`/`endTime` (`HH:mm`), `recurring`,
`occurrenceDate`, `buildings`, `active`, `deleted`, `broadcasting`,
`lastBroadcastSeenAt` (the BLE heartbeat), and the code-rotation pair
`manualCodeRotationMode` (`none|interval`) / `manualCodeRotationSeconds`.
`occurrenceDate` is required for one-time sessions and null for recurring sessions.
`buildings` requires at least one entry — GPS runs for every session and needs a polygon
to measure against. There is no `verification` field.

**`active` means "collecting attendance right now"** — created `false` always, and the
*only* way it becomes `true` is `PATCH /:sessionId/activate` ("Collect"/"Join" client-side),
which itself requires being inside the session's own scheduled window
(`isScheduledNow`) — collecting outside class time is rejected, not just hidden client-side.
Three states fall out of `active` combined with the window:

| `active` | in window | client-facing stage |
|---|---|---|
| — | no | Inactive |
| `false` | yes | Within-session |
| `true` | yes | Collecting |

GPS verification runs for every student throughout Collecting regardless of Bluetooth —
it has no on/off switch — so a broadcasting phone's radio failing never touches `active`;
only an explicit `PATCH /:id/deactivate` or the window closing does. Recurring sessions
have no expiry date, so nothing else would ever clear `active` between weekly
occurrences — a background sweep (`deactivateRecurringSessionsPastWindow`, alongside the
existing one-time-session expiry sweep) resets it once each day's window closes, so every
occurrence needs its own explicit Collect tap.

### Geofence

Name, active/deleted state, and an ordered polygon of `[lng, lat]` vertices. Only
`active: true, deleted: false` buildings are listed, selectable, or accepted.

Deleting a building is refused while any live session still references it, whether or
not that session lists other buildings alongside it — the polygon is part of how the
session decides who is present, so it has to be taken off the sessions deliberately
first. Sessions that are themselves soft-deleted don't count, since they never run
again.

### Attendance

Student/course/session references, `courseCode` and `lectureCode` (stable
human-readable labels for the course and the lecture occurrence, so a row stays readable
after either is renamed), `attendanceDate` (local `YYYY-MM-DD`), `timestamp`, and:

```text
status = present | flagged                     ← the only field the lecturer sees
method = bluetooth | gps | code_override       ← server-internal
band   = inside | near | suspicious | far | unknown   ← server-internal
reason = human-readable string, `flagged` only ← surfaced only in the Excel export
```

GPS and code records may additionally store
`{ centroid: { lat, lng, fixCount, distanceM } }`, plus `seedRelayed` for BLE. All of
these except `status` (and `reason`, in the Excel export only) are audit-only and never
leave the server. The unique index `{ student, session, attendanceDate }` makes every
path idempotent; a genuine automatic pass upgrades an existing `flagged` row to
`present`, and a fresh `flagged` verdict from a repeat code submission overwrites an
existing `flagged` one so the stored reason/distance reflects the latest evidence rather
than freezing on the first submission. Which bands write a row at all is specified under
"Verification contract" above.

### BleToken / ManualCode / Settings

- `BleToken`: `sessionId`, `owner` (null for the primary row), `role` (`primary|seed`),
  `token`, `prevToken` (the value still accepted during the rotation grace),
  `generatedAt`, `leaseUntil` (seed rows), `slot`, and `updatedAt` — which also drives a
  1-hour TTL index as a safety net if a teardown is ever missed.
  `verifyToken` reports which row matched, because only a primary match may seed. Seed
  rows also carry a `slot` (0-based, below `Settings.seedRate`) under a unique partial
  index: the cap is enforced by claiming a numbered slot, not by counting live seeders
  and then minting. Counting first was a check-then-act race — a lecture's worth of
  students accepted in the same instant all read a count under the cap and all minted,
  measured at 28 seeders against a `seedRate` of 5 — which widened the effective BLE
  radius that "hearing the beacon proves you are in the room" depends on.
- `ManualCode`: `session`, `code`, `prevCode` (accepted for 2 s after an automatic
  rotation, and left null after a forced regenerate so the old code dies at once),
  `generatedAt`, and `paused`. Deliberately not merged into the BLE token pool —
  different entropy, different lifecycle. Every session has one.
- `Settings` stores the Bluetooth kill switch, the two distance buffers, the
  independently selectable near/far buffer-logic strategy ids (`nearBufferLogic`,
  `farBufferLogic`, default `accuracy_weighted_centroid` — see
  `services/geofenceLogic.service.js`), the seeding parameters (`seedRate`, and
  `seedWindowMs` — the window length given identically to real seeders and decoys so the
  two are indistinguishable), the student sign-in email
  domain (`studentEmailDomain`, empty disables the check), and the minimum Android
  `versionCode` (`minSupportedVersionCode`, `0` disables the check).

## API reference

All JSON mutation requests must carry an `X-Requested-With` header. Any non-empty value
is accepted — the guard tests for presence, not content (Android sends
`attendance-android`, the web client sends `XMLHttpRequest`); what stops a cross-site
form POST is that HTML forms cannot set the header at all. `student`, `staff`, and
`admin` below refer to server-derived session roles, never trusted client headers.

### Authentication and public routes

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/auth/google-nonce` | public/rate-limited | nonce for native sign-in |
| POST | `/api/auth/google-id-token` | public/rate-limited | verify Google ID token and create session |
| GET | `/auth/google` | public/rate-limited | browser OAuth fallback |
| GET | `/auth/google/callback` | public/rate-limited | OAuth callback |
| POST | `/api/auth/exchange-code` | public/rate-limited | consume native fallback exchange code |
| GET | `/api/me` | authenticated | current account and role |
| POST | `/api/logout` | public | destroy session — deliberately ungated, so it is idempotent and can never fail; with no session it is a no-op returning `{ success: true }`. The CSRF header is still required. |
| GET | `/api/healthz` | public | process/database health |
| GET | `/api/app-version` | public | `{ minSupportedVersionCode }` — client blocks below this |
| GET | `/api/web-config` | public | `{ allowNonIos }` — whether the web client serves non-iOS devices |
| GET | `/` | public | 302 to `/app/` — the client is mounted under a path, and the bare domain is what people type |
| GET | `/privacy` | public | current privacy policy |
| GET | `/delete` | public | account deletion instructions |
| GET | `/app/*` | public | iOS web client (static bundle + SPA fallback) |

`/api/web-config` is deliberately one boolean and unauthenticated: the web client decides
whether to serve a non-iOS device *before* anyone has signed in, and nothing else from the
admin-only settings singleton should reach an anonymous caller. It reflects the
`webAllowNonIos` setting, which is off by default and toggled by an admin from the
Android dashboard. It is a UX gate, not a security control — the client decides by
reading its own user agent, which anyone can spoof.

The root redirect is deliberately temporary (302), not permanent: browsers cache a 301
more or less forever, which would make giving `/` a page of its own later painful.

`/app` serves the React student client from `web/dist` — see [../web/README.md](../web/README.md).
It is mounted on this server's own origin because the session cookie above is httpOnly
and Safari blocks third-party cookies, so a separately-hosted client could never stay
signed in. The mount is path-scoped and cannot shadow `/api`, `/auth`, `/privacy` or
`/delete`; `webApp.routes.test.js` asserts exactly that. An unbuilt client answers 503
rather than failing the process, so an API-only deploy still starts. The client reuses
`GET /auth/google` with `returnTo` set to the app's own base — no separate OAuth client
or CORS entry is involved.

### Student discovery and attendance

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/courses/running` | authenticated | running courses — identity only; the flow never branches |
| GET | `/api/courses/catalog` | student | every unarchived course, campus-wide, ignoring session state — for the registration screen |
| GET | `/api/courses/registered` | student | this student's registered course ids |
| POST | `/api/courses/registered/:courseId` | student | register (idempotent; 404 if archived/unknown) |
| DELETE | `/api/courses/registered/:courseId` | student | unregister (idempotent) |
| GET | `/api/attendance-status?courseId=` | student | `{ status: present\|flagged\|none }` |
| POST | `/api/attendance` | student | unified `{ courseId, token? | fix? | code?, canAdvertise }` |
| GET | `/api/attendance/seed-token?sessionId=` | student | rotate/re-fetch owned live seed token |
| DELETE | `/api/attendance/seed-token?sessionId=` | student | relinquish owned lease after radio failure |
| GET | `/api/bluetooth-target?courseId=` | student | `{ available }` — whether scanning is worth the window |

Exactly one of `token`, `fix`, or `code` is accepted by `POST /api/attendance`. The
response `status` is `collecting` (keep going — deliberately ambiguous between "not
enough fixes yet" and "not in a passing band"), `accepted`, or `flagged`, plus optional
`duplicate` and peer-seeding instructions. Attendance record details (band, method,
centroid, reason) are never echoed to the student.

### Courses and reports

Base path: `/api/admin/courses`.

| Method/path | Access | Purpose |
|---|---|---|
| `GET /?page=&limit=&lecturerId=` | staff | owned courses; admins see all, or one lecturer's with `lecturerId`. Omitting `limit` returns everything; passing it pages (`{ items, total, page, limit, hasMore }`) |
| `POST /` | staff | create a course — `batches: string[]` creates one Course document per batch |
| `PATCH /:courseId/assign-lecturer` | owner/admin | wholesale reassignment — set any number of owners (add or remove); a lecturer may only do this on a course they already own |
| `PATCH /:courseId/disable` / `enable` | owner/admin | toggle course — this is also what "delete" means; no destructive delete exists |
| `POST /:courseId/sessions` | owner/admin | atomically create schedule, buildings (≥1, required), and code rotation |
| `GET /:courseId/attendance-matrix` | owner/admin | per-student `present` / `flagged` / absent matrix (JSON) |
| `GET /:courseId/attendance-matrix.xlsx` | owner/admin | the same matrix as a downloadable Excel file — flagged cells are red-filled with the reason as a cell comment |

### Sessions

Base path: `/api/admin/sessions` (owner/admin session guard applies).

| Method/path | Purpose |
|---|---|
| `GET /?page=&limit=` | list accessible sessions, soonest/currently-running first. Omitting `limit` returns everything; passing it pages (`{ items, total, page, limit, hasMore }`) |
| `GET /running` | sessions whose scheduled window is open right now, **not** filtered by `active` — `{ sessionId, active, broadcasting }` per entry, refreshed on a faster cadence than the full list so a client can tell Within-session apart from Collecting without a full reload |
| `PATCH /:sessionId/activate` / `deactivate` | "Collect"/"Join" and "Deactivate" client-side — `activate` requires being inside the session's own window right now (see LectureSession above) |
| `DELETE /:sessionId` | soft-delete and revoke secrets |
| `PATCH /:sessionId/broadcast` | set `{ on }`; 403 while the global BLE switch is off |
| `GET /:sessionId/broadcast` | staff token poll/heartbeat and live counts |
| `GET /:sessionId/manual-code` | current staff-only lecturer code/status |
| `PATCH /:sessionId/manual-code` | pause, resume, rotate, or regenerate (no enable flag) |

There is no reviews endpoint — a `far`/`unknown` code submission is written directly as a
`flagged` `Attendance` record (see "Verification contract" above); the only place it
becomes visible to staff is the Excel export under `/api/admin/courses`.

### Admin policy and directories

| Method/path | Access | Purpose |
|---|---|---|
| `GET /api/admin/settings` | staff | current policies |
| `PATCH /api/admin/settings` | admin | BLE kill switch, distance buffers, per-band geofence-logic strategy, seeding, student email domain, minimum app version |
| `GET /api/admin/geofences` | staff | active selectable buildings |
| `POST/PATCH/DELETE /api/admin/geofences/:id?` | admin | building polygon management; `DELETE` is refused (400) while any live session still uses the building |
| `GET /api/admin/lecturers?q=&page=&limit=` | staff | lecturer directory — readable by any staff member on purpose, so an owner can find a co-owner to add to their own course |
| `POST/DELETE /api/admin/lecturers/:id?` | admin | create, or hide (soft-delete) rather than destroy |

Deleting a lecturer never invents a substitute owner for their courses. If removing them
would leave an *active* course with zero lecturers, the whole delete is refused (400) before
anything is touched; an *archived* course is allowed to end up ownerless, since it runs no
sessions and takes no attendance.

## Things that are easy to miss

Deliberate behaviour that is not obvious from reading the routes, and that a reviewer
should know about before concluding anything.

- **There is a test-only authentication bypass.** When `NODE_ENV=test`, `middlewares/testAuth.js`
  is mounted and an `x-test-user` header injects an arbitrary `req.user` — any role, no
  password, no session. It is what the route tests use instead of standing up Google
  OAuth. It is gated at mount time in `app.js`, so it does not exist in a production
  process, but **never run this server with `NODE_ENV=test` on a reachable host.**
- **There is a hardcoded bootstrap admin.** `BOOTSTRAP_ADMIN_EMAIL` in
  `utils/constants.js` is created if absent and, on **every boot**, force-reset to
  `role: 'admin'`, `deleted: false`, `active: true`. A system needs a first admin before
  anyone can grant admin, so this is the break-glass account — but it also means demoting
  or deleting it does not stick past the next restart, and whoever controls that mailbox
  has permanent admin. Change the constant before deploying an installation you do not
  control that address for.
- **`SESSION_SECRET` has a development fallback** (`'dev-only-secret'`). Production cannot
  start without a real one — `config/env.js` exits at boot — but a non-production process
  will happily run with a publicly known signing key.
- **Request bodies are capped at 256 kb** (`app.js`), which is the limit behind the 413 in
  the error table below.
- **`trust proxy` is set to 1**, so `req.ip`, the rate-limiter key, and the secure-cookie
  decision all come from `X-Forwarded-*`. That is correct behind the one nginx hop this
  deploys with, and wrong — spoofable — if the app is ever exposed directly.
- **Session cookies last 7 days** (`attendance.sid`, httpOnly, `SameSite=None; Secure` in
  production), with the store TTL matched to it and touched at most hourly.
- **A broadcast goes stale after 30 s** without a token poll (`BROADCAST_STALE_MS`). The
  broadcasting phone polls every ~5 s, so that is six missed polls before students are
  refused at read time and the sweep flips the flag off.

## Audit log


Every staff/admin mutation and every rejected authentication or authorization attempt is
appended to the **`auditlogs`** collection in the same MongoDB database as everything
else — there is no separate log file and nothing is written to stdout. Query it with the
same `MONGO_URI` the server uses:

```js
db.auditlogs.find().sort({ at: -1 }).limit(50)               // most recent activity
db.auditlogs.find({ target: "<sessionId>" }).sort({ at: 1 })  // what happened to one object
db.auditlogs.find({ actorEmail: "x@eng.pdn.ac.lk" })          // what one person did
db.auditlogs.find({ outcome: "denied" }).sort({ at: -1 })     // rejected attempts
```

Each row records `actor` (Person id), `actorEmail`/`actorRole` (denormalised so the entry
stays readable after the person is deleted), `action` (`DELETE /api/admin/sessions/:id` —
object ids collapsed so rows group), `target` (the ids from the path), `status`,
`outcome` (`allowed`/`denied`), `ip`, and `at`.

What is kept, and what is not:

- **Kept:** every successful mutating request under `/api/admin/*`; sign-in via
  `/api/auth/google-id-token` and `/api/auth/exchange-code`; every 401/403 on an admin
  route or on any mutation anywhere.
- **Not kept:** ordinary reads, student check-ins, and polling. Attendance already has
  its own permanent record with full provenance, and the polls would bury everything else.

Rows expire automatically after two years (a TTL index on `at`) — past any academic
appeal window, and short enough that the collection never needs managing.

Writes happen after the response has been sent, and a failure is logged and swallowed:
losing an audit row is bad, but failing a lecturer's session delete because the audit
write failed is worse. `middlewares/auditLog.js` reads the path from `req.originalUrl`,
not `req.path`, because Express rewrites `req.url` while a request is inside a mounted
sub-router and the `finish` event fires while that rewrite is still in effect.

## Rate limits

Two separate budgets on `POST /api/attendance`, both keyed per signed-in student (falling
back to a normalised IP subnet):

| Path | Limit | Why |
|---|---|---|
| any submission | 180/min | A 90 s GPS attempt streams a fix every 3 s (~30 requests), so this leaves room for roughly six honest attempts a minute. |
| `code` submissions only | 10/min | The 8-digit code is the only guessable secret in the system. |

The split exists because a single shared budget of 60/min was both too loose to stop
brute-forcing and tight enough to break honest use: two attempts filled the quota and a
third — the one a student in a weak-signal room actually needs — was refused as abuse.
Streaming GPS fixes can no longer consume the code budget.

`/auth/*` and the sign-in endpoints keep their own 20/min limiter.

## Background jobs and caches

- Non-recurring session expiry.
- Recurring-session `active` reset once each day's window closes.
- Stale/out-of-window broadcast closure.
- Out-of-window lecturer-code removal (every session, since every session has a code).
- Expired seed-token cleanup (verification independently checks leases).
- Expired attempt-verdict sweep (10-minute TTL).
- Short active-session cache invalidated on relevant staff mutations.
- OAuth exchange/nonces, GPS attempt fixes, and attempt verdicts are in-memory and
  therefore assume a single Node process; use a shared store before
  horizontal scaling.

## Testing

```bash
npm test -- --runInBand
```

314 tests across 21 suites, covering authentication, route access, BLE rotation and
broadcasting (including the previous-token grace vs. the broadcaster poll interval),
seeder slot claiming and the cap under contention, distance banding, the accuracy ceiling
and accuracy-unknown normalisation, outlier trimming, the code-escalation outcomes for
every band, flag-reason rendering, the geofence-logic strategy registry, the
flagged-record Excel export, running-course DTO contracts, strict schedules/one-time
dates, GPS geometry and fix filtering, active geofences, the geofence delete guard,
seeder eligibility, the `/auth/native-return` target allow-list and its escaping,
body-parser error classification, pages, and unified attendance. Keep Android and server
contract tests aligned whenever a response changes.

Not yet covered by a dedicated test: multi-batch course creation, the lecturer-owner path
through `assign-lecturer` (as opposed to the admin path), pagination on the three admin
list endpoints, the lecturer directory's staff-wide (not admin-only) access, the student
email domain gate, the
`minSupportedVersionCode` app-version check, the Collect/`activateSession` schedule-window
gate, the recurring-session window-close sweep, `isScheduledNow`/`getRunningSessionsForStaff`'s
active-independent window check, `sessionSortRank`'s "is this session's day today"
check (a real regression here already shipped once — a wrong-weekday session tied for
rank 0 whenever its time-of-day window happened to overlap the current clock time; fixed,
but the fix has no regression test yet), and the `any_point_within`/`median_distance`/
`best_accuracy_fix` geofence-logic strategies end-to-end through `POST /api/attendance`
(they're unit-tested directly against `geofenceLogic.service.js`, but not exercised
through a live GPS-band request the way `accuracy_weighted_centroid` is). Add contract
tests for these before relying on CI to catch a regression there.
