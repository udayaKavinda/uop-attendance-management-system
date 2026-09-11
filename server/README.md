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

- Node.js 20.19+ (enforced via `package.json`'s `engines` field — `mongoose@9`'s own
  floor, `npm install`/`ci` warns below it)
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
| no usable fix at all | `unknown` | correct code → flagged¹ |

¹ "Flagged" is not a queue, and it is not a lesser form of attendance — the lecturer read
the code out, so the student is present. It's an `Attendance` row with `status: 'flagged'`
and a `reason`, kept distinct only so a `far`/`unknown` code acceptance can be told apart
internally from an ordinary pass. Every display surface (the on-screen matrix on both
clients, and the Excel export) renders `flagged` exactly like `present` — the cell reads
`P`, never a separate letter — and only the Excel export additionally red-fills it and
attaches the reason as a cell comment, e.g. "GPS location is 25.0km from the nearest
session building." or "Could not verify location." (no usable fix at all). Nobody approves
or rejects it. `suspicious` always passes on a correct code now — there is no admin switch
for it, unlike `far`/`unknown` which never pass *automatically*, only via a correct code.
Crucially, `suspicious`, `far`, and `unknown` all require the student to actually submit
the "get help" code to produce **any** `Attendance` record at all — raw GPS fixes alone
never write one for these three bands, so a student who never falls back to the code
leaves no trace, exactly like one who never checked in (rendered as `-`, not blank).

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
  If trimming leaves fewer than 3 trustworthy fixes the attempt reports "not ready" and
  waits for more, rather than banding on fixes it has already judged unreliable.
- A reported accuracy of `0` means "unknown" (Android returns it when `hasAccuracy()` is
  false), not "perfect", and is normalised to a pessimistic 50 m for both centroid
  weighting and best-fix selection.
- Every band decision runs on distance alone — there is no accuracy floor below which an
  attempt is forced to `unknown`; a low-accuracy fix simply gets less weight in the
  centroid than a precise one.
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

### The help code

- Every session has an 8-digit code. The lecturer chooses only whether it rotates
  (`manualCodeRotationMode`); the live value lives in `ManualCode` and exists only inside
  the schedule window.
- Rotation is **lazy**, exactly as it is for BLE tokens: the code changes on the first
  call that finds it older than the interval, not on a timer. Nothing rotates while
  nobody is asking.
- The previous code stays valid for a 2-second grace (`GRACE_MS`) so a student who was
  part-way through typing a code that rotated mid-entry is not punished for it.
- **The grace applies only when the rotation was due, never when it was overdue.**
  `verifyCode` calls `getOrRotateCode`, so a submission can itself be the call that
  performs an overdue rotation. That stamps `generatedAt: now`, which made the code it
  had just demoted to `prevCode` measure 0 ms old and pass the grace check no matter how
  long it had actually been live — a code read out ten minutes earlier was still
  accepted. It reproduced only when nothing else polled in between, i.e. the lecturer's
  dashboard was closed or the phone asleep; with the dashboard open, rotation happened on
  schedule and the same submission was correctly rejected. `getOrRotateCode` now drops
  `prevCode` when the rotation is overdue by more than the grace.
- **A read refreshes the row's `updatedAt` once it passes `TTL_REFRESH_AFTER_MS` (15
  min).** `ManualCode` carries a 1-hour TTL index as safety cleanup for sessions that
  were never deactivated, but reading a code is not a write: all three of the paths that
  hand back a stored code — `none` mode, paused, and interval-not-yet-due — used to
  return the document untouched, and nothing else wrote either. `none` is the default for
  both clients, so `updatedAt` froze at creation and Mongo deleted a perfectly live code
  exactly one hour in. The standard slots are two hours, so this landed mid-lecture: the
  next caller found no row, minted a fresh code, and the value the lecturer had read out
  or written on the board started being rejected — while their own dashboard showed the
  new one, making it look like the students were mistyping. Refreshing on read makes the
  TTL measure time since the code was last *used* rather than since it was created, at
  about four writes an hour per live session.
- The equivalent BLE path is not affected twice over: `verifyToken` reads the token pool
  without rotating it, so its `generatedAt` always reflects a real rotation; and
  `BleToken` carries the same 1-hour TTL but rotates every 15 seconds while a session
  broadcasts, so its `updatedAt` is never stale enough for the TTL to fire.
- Found by the multi-week usage simulation, not by unit tests — the unit tests build the
  `ManualCode` document directly, so the rotate-during-verify path never ran.

### The schedule window

A session's window is **half-open: `[startTime, endTime)`**. It opens at the start minute
and closes the moment the clock reads `endTime` — 09:00-11:00 is live at 10:59 and over at
11:00:00.

This is not cosmetic. Back-to-back slots (09:00-11:00 then 11:00-13:00) are the ordinary
shape of a timetable, and `findScheduleOverlap` has always permitted them, treating times
as half-open (`sStart < newEnd`). The window check used to be closed at both ends
(`currentMinutes > end` meant "out"), so the boundary minute belonged to **both** sessions —
a pair the system allowed you to create and then could not tell apart.
`resolveActiveSessionForCourse` picks with `sessions.find(...)`, i.e. the first match in
whatever order Mongo returned, so a student checking in at 11:00 for the lecture that was
starting could be recorded against the one that had just finished. Every day, for sixty
seconds, with nothing shown to either party.

Four comparisons implement this and only work as a set — change one and you reopen the
gap:

| Where | Rule |
| --- | --- |
| `evaluateScheduleWindow` | `currentMinutes < start \|\| currentMinutes >= end` |
| `isNonRecurringExpired` | spent once `nowMinutes >= end` |
| `nextOccurrenceDate` | today's slot is spent at `currentMinutes >= end`, so it rolls a week |
| `sessionSortRank` | "running right now" is `nowMin >= startMin && nowMin < endMin` |

The **start** stays inclusive: a session is live at exactly `startTime`. Only the end moved.
`startTime >= endTime` is rejected at create, so a half-open window is never empty.

The practical consequence is that a session stops accepting check-ins one minute earlier
than it used to — at `10:00:00` rather than `10:00:59` for a lecture ending at 10:00.

### One-time sessions

Weekly sessions have `recurring: true`. A one-time session receives an explicit local
`occurrenceDate` (`YYYY-MM-DD`) for the next selected weekday. It cannot run again on a
later week; expired one-time sessions must be recreated.

Once its occurrence has passed, a one-time session is dropped from the staff session list
(`GET /api/admin/sessions`) — it can never collect again, so the card is unusable. The row
is not deleted: it still labels its own columns in the attendance matrix and the .xlsx
export, which resolve sessions by id per-course rather than through that list. A row that
is *malformed* rather than spent (missing `recurring`, or one-time with no `occurrenceDate`)
stays listed on purpose, so a data problem is visible instead of silently erased.

Because the create form takes a *weekday* and the server derives the date, the create
response carries a `message` naming the date it chose — "One-time session created for
today (Mon 14 Sep), 10:00-12:00", or without the "today" when it rolled to the next
occurrence. Identical taps produce different dates either side of `endTime`, and this is
the only point at which a lecturer can catch the wrong one; both clients display it and
fall back to a generic line if it is absent.

Two one-time sessions collide only when they land on the **same** `occurrenceDate`.
Sharing a weekday is not a clash — a session on the 10th and a session on the 17th can
never both run. `findScheduleOverlap` therefore takes the new session's date as a fifth
argument and skips an existing row when both sides are explicitly one-time and the dates
differ. Everything else still collides on weekday + time alone, because a weekly session
runs on that weekday every week:

| new | existing | clash? |
| --- | --- | --- |
| weekly | weekly | yes, if the times overlap |
| weekly | one-time | yes — the weekly runs on that date too |
| one-time | weekly | yes — same reason, other way round |
| one-time | one-time, same date | yes |
| one-time | one-time, different date | **no** |
| anything | spent one-time | no — it can never run again |

The date is derived **before** the clash check, in `createSession`, and the same value is
then written to the row. It used to be derived inside the `create()` call, i.e. after the
check had already run, which is why the check had no date to compare and fell back to
weekday + time. One derivation also keeps the two honest for a session created exactly as
`endTime` passes, where deriving twice checks one date and saves another.

`checkSessionOverlap` prunes spent one-time sessions using **the same rule
`listAllForStaff` hides cards by**, and that alignment is the point rather than an
incidental tidy-up. It previously pruned by date alone (`occurrenceDate >= today`), so
between a session's window closing and midnight the row was hidden from the Sessions tab
but still counted as a clash — the lecturer was blocked by a session they could not see,
under an error instructing them to go and delete it. If either rule is changed, change
both, or that dead end comes back. Both are deliberately stricter than
`isNonRecurringExpired` alone (`recurring === false` **and** a non-empty `occurrenceDate`
**and** expired) so malformed rows stay in the comparison and keep reporting a clash
rather than quietly dropping out of it.

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
status = present | flagged                     ← both render as "P" everywhere; see below
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
- `ManualCode`: `session`, `code`, `prevCode` (accepted for 2 s after an *on-time*
  automatic rotation, left null after a forced regenerate so the old code dies at
  once, and also left null when the rotation was overdue — see **The help code**),
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

Every rejection carries a human-readable reason in `{ "error": "..." }` (the auth guards
use `message`; both clients read either). Staff-facing rejections are written to name the
cause **and** the remedy, because the client renders them verbatim into the error banner
with nothing else to go on — so "This session overlaps with an existing session" became
`10:00-12:00 clashes with this course's existing MON session at 09:00-11:00 (weekly).
Pick a time outside that range, or delete the other session first.` The same applies to
archived courses (named, with "unarchive it from the Courses tab"), out-of-window Collect
and broadcast attempts (the window itself is quoted back), and buildings that have since
been deleted. Do not reintroduce bare states like `Course is disabled` — a lecturer
cannot act on one.

A remedy the lecturer cannot carry out is worse than a bare state, and the clash message
was one: it can only ever cite a session that is still visible in the Sessions tab. See
**One-time sessions** below for why that needs saying.

`middlewares/errorHandler.js` applies the same rule to the errors Mongoose raises rather
than the routes: a `CastError`, a `ValidationError` and a duplicate-key 11000 all name the
**field** involved. They must never name the **value** — field names come from our own
schemas and are safe to echo, whereas the offending value is caller-supplied and may be
personal data. `fieldNames()` drops anything that is not a plain schema path, so nothing
unexpected can be reflected back; `bodyErrors.routes.test.js` pins both halves.

### Authentication and public routes

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/auth/google-nonce` | public/rate-limited | nonce for native sign-in |
| POST | `/api/auth/google-id-token` | public/rate-limited | verify Google ID token and create session |
| GET | `/auth/google` | public/rate-limited | browser OAuth fallback |
| GET | `/auth/google/callback` | public/rate-limited | OAuth callback. On success redirects to `/login/success`; on failure to `/?error=<code>` where `<code>` is one of `domain` (plus `&domain=<host>`), `no_email`, `session`, or `auth`. Codes, never `err.message` — this lands in a URL and the message can carry driver internals. Both clients map the codes to copy (`signInFailureMessage` in web, `oauthReturnFrom` on Android); keep the three in step |
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
| `PATCH /:courseId/disable` / `enable` | owner/admin | toggle course — this is also what "delete" means; no destructive delete exists. `enable` is refused (400) while the course has no assigned lecturer |
| `POST /:courseId/sessions` | owner/admin | atomically create schedule, buildings (≥1, required), and code rotation Responds `{ success, session, message }`, where `message` names the date the server derived (see One-time sessions) |
| `GET /:courseId/attendance-matrix` | owner/admin | per-student `present` / `flagged` / absent matrix (JSON), bare status only — no `reason` |
| `GET /:courseId/attendance-matrix.xlsx` | owner/admin | the same matrix as a downloadable Excel file — every record is `P` (absent is `-`, never blank); `flagged` cells are additionally red-filled with the reason as a cell comment |

Columns are per **occurrence** (`session` + `attendanceDate`), not per `LectureSession`
document: a recurring session is one document reused every week
(`deactivateRecurringSessionsPastWindow` resets `active` and the lecturer taps Collect
again next week on the same `_id`), so a course that has run several weeks gets one
column per week attended, each labeled with that week's date. Column `_id`s are opaque
strings (`"<sessionId>|<attendanceDate>"`) — both clients already treat `_id` as a plain
lookup key, so this needed no client changes.

### Sessions

Base path: `/api/admin/sessions` (owner/admin session guard applies).

| Method/path | Purpose |
|---|---|
| `GET /?page=&limit=` | list accessible sessions, soonest/currently-running first. Spent one-time sessions (occurrence passed) are omitted, as are sessions belonging to an **archived course** (`course.active === false`) — `disableCourse` already deactivates them and `activate` refuses to bring them back, so they can only ever be dead cards; unarchiving the course restores them. `total`/`hasMore` count the visible set. Omitting `limit` returns everything; passing it pages (`{ items, total, page, limit, hasMore }`) |
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
| `POST/PATCH/DELETE /api/admin/geofences/:id?` | admin | building polygon management. Both `DELETE` and a `PATCH` setting `active: false` are refused (400) while any live session still uses the building — switching one off is the same outage as deleting it, since banding filters on `{ deleted: false, active: true }` and cannot tell the two apart. Re-activating is never blocked. Renames and polygon edits are unaffected |
| `GET /api/admin/lecturers?q=&page=&limit=` | staff | lecturer directory — readable by any staff member on purpose, so an owner can find a co-owner to add to their own course |
| `POST/DELETE /api/admin/lecturers/:id?` | admin | create, or hide (soft-delete) rather than destroy |

Deleting a lecturer never invents a substitute owner for their courses. If removing them
would leave an *active* course with zero lecturers, the whole delete is refused (400) before
anything is touched; an *archived* course is allowed to end up ownerless, since it runs no
sessions and takes no attendance.

Because of that allowance, `PATCH /:courseId/enable` refuses (400) a course whose
`lecturers` list is empty, naming the real problem: assign a lecturer, then activate. The
Course schema already forbids an active course with no owner, so without the check the
re-activation reached `save()` and threw a ValidationError, which the error handler
rendered as `These fields are missing or invalid: lecturers.` — a field the admin never
touched, on a button labelled Enable, with nothing pointing at the fix.

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
- GPS fix-buffer sweep, every `FIX_WINDOW_MS` (90 s), dropping buffers with no live
  fix left. `addFix` prunes stale fixes but only for the key being written, and
  `clearFixes` runs only on a **pass** — so every attempt that never passed (location
  denied, out of range, app closed mid-scan) used to keep its key for the life of the
  process. Measured at ~10.9 MB retained for 2000 abandoned attempts, with no ceiling
  across a semester; one sweep releases all of it. It cannot change a verdict, only
  memory: a buffer in that state holds nothing but fixes the next `addFix` would drop
  anyway, and `evaluateFix` always goes through `addFix` first. Both this timer and the
  verdict sweep are `unref`'d, so neither holds the process open.
- Short active-session cache invalidated on relevant staff mutations, and re-checked
  against the schedule window on every hit — the entry is an admission decision, so
  age alone must not keep it valid past `endTime`.
- OAuth exchange/nonces, GPS attempt fixes, and attempt verdicts are in-memory and
  therefore assume a single Node process; use a shared store before
  horizontal scaling.

## Testing

```bash
npm test -- --runInBand
```

506 tests across 36 suites. 485 of those run with every Mongoose model mocked and need
no database. The remaining suite, `dbIntegration.test.js`, talks to a real MongoDB —
schema defaults, validators, `populate` and unique indexes cannot be verified by mocking
the layer that implements them.

It needs no setup: `jest.globalSetup.js` probes `mongodb://127.0.0.1:27017` before the
run and, if a mongod answers, points the suite at the **`uop_attendance_test`** database.
With no local mongod the suite skips itself and the other 35 run as normal, so a machine
or CI runner without a database still goes green. Set `MONGO_TEST_URI` to override the
target, or to `off` to skip the probe entirely — which is what CI does, because the
deploy runner *is* the production host and a test process must never open a connection
there.

That database is **dropped** before and after the run. The name is hard-coded and never
derived from `MONGO_URI`, and the suite refuses to start if it is pointed at the database
the application itself uses — an accidental `MONGO_TEST_URI=.../attendance` fails loudly
instead of destroying local data. It
covers the persisted `active: false` on create, the one-time `occurrenceDate` required
validator, the `buildings` minimum, the unique `(code, batch)` course index, one-time
date resolution either side of `endTime`, overlap detection (including two one-time
sessions a week apart, which must not collide), the staff list's hiding and
lecturer scoping through real `populate`, both expiry sweeps, soft delete, student-facing
course resolution, and the unique `(student, session, attendanceDate)` attendance index.

The mocked suites cover authentication, route access, BLE rotation and
broadcasting (including the previous-token grace vs. the broadcaster poll interval),
seeder slot claiming and the cap under contention, distance banding at the exact buffer
boundary, accuracy-unknown normalisation, outlier trimming, the code-escalation outcomes
for every band, flag-reason rendering, the geofence-logic strategy registry (including
`any_point_within`/`median_distance`/`best_accuracy_fix`/`all_points_within` exercised
end-to-end through a live `POST /api/attendance` GPS stream, not just unit-tested against
`geofenceLogic.service.js` directly), `settings.service.buffers()`'s normalisation
(defaults, clamping `farBufferM` up to `nearBufferM`, unrecognized-strategy-id passthrough
and fallback), admin-configured `nearBufferM`/`farBufferM`/`nearBufferLogic`/
`farBufferLogic` changing a live band decision, GPS attendance staying unaffected by the
global Bluetooth kill switch, the flagged-record Excel export, the attendance matrix and
Excel export keying columns by occurrence (session + attendanceDate) so a recurring
session run across several weeks gets one column per week instead of later weeks
silently overwriting earlier ones, running-course DTO contracts, strict schedules/one-time
dates, GPS geometry and fix filtering, active geofences, the geofence delete and deactivate guards,
seeder eligibility, the `/auth/native-return` target allow-list and its escaping (including a round-trip test feeding every query `oauthFailureQuery` can emit straight into `parseNativeReturnTarget`, after the two drifted apart and a rejected email domain reached the user as a blank 400 instead of an explanation),
body-parser error classification, pages, and unified attendance. Also now covered: the
student email-domain gate on brand-new Google sign-ins (rejects outside the configured
domain, passes existing accounts through regardless, and the empty-domain "gate off" case),
`GET /api/app-version`'s `minSupportedVersionCode` passthrough, `GET /api/healthz` actually
reflecting live Mongo connectivity (503 when disconnected — the automated deploy rollback
depends on this being honest), the Collect/`activateSession` schedule-window gate, the help code's rotation grace refusing to revive an overdue code (see **The help code** above), the
recurring-session window-close sweep forcing a fresh Collect tap each week, and
`sessionSortRank`'s "is this session's day today" check (a real regression shipped once
before — a wrong-weekday session tied for rank 0 whenever its time-of-day window happened
to overlap the current clock time; fixed, and now has a regression test), `listAllForStaff`
hiding spent one-time sessions (which, ranked by their past date, had sorted ahead of every
upcoming session) while keeping malformed rows visible, and the active-session cache
refusing to serve an admission whose window has closed, and the create response's
`message` naming the derived one-time date (including the ICU-independent date rendering
and the malformed-date fallback). Keep Android and
server contract tests aligned whenever a response changes.

Not yet covered by a dedicated test: multi-batch course creation, the lecturer-owner path
through `assign-lecturer` (as opposed to the admin path), pagination on the three admin
list endpoints, the lecturer directory's staff-wide (not admin-only) access, and
`isScheduledNow`/`getRunningSessionsForStaff`'s active-independent window check specifically
(distinct from the Collect-gate and sweep cases above, which are now covered).
