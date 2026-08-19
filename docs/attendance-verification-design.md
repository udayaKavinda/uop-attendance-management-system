# Attendance Verification Design — Implemented System

Status: implemented. This document describes the system as built, not a proposal.

## The model in one paragraph

Every lecture session verifies attendance the same way. There is no per-session policy
to choose. When a student checks in, their phone spends up to 90 seconds listening for
the lecturer's Bluetooth beacon *and* streaming GPS fixes at the same time; either one
can pass them, and the first to succeed ends the window. If neither does, they are
offered **Try again** (another 90 seconds) or **Get help**, which asks for the 8-digit
code the lecturer reads out. What that code grants depends on how far from the building
the student's GPS put them — close enough and it passes them outright, too far and it
only queues them for the lecturer's review.

## Explicit product boundaries

- Course discovery is campus-wide. No enrolment/registration source exists in this
  repository, so the server does not infer membership from course batch or email format.
- GPS verification is foreground and permission-based; the app does not continuously
  track students.
- In-memory nonce, code-attempt, GPS-fix, and attempt-verdict state assumes one server
  process. A shared store is required before horizontal scaling.

## Decision table

Distances are measured from the edge of the session's building polygon and are
admin-configurable (defaults shown).

| Evidence gathered in the window | Result | Student sees |
|---|---|---|
| Valid BLE token received | **Present** | Attendance recorded |
| GPS centroid inside the polygon | **Present** | Attendance recorded |
| GPS centroid within `nearBufferM` (50m) | **Present** | Attendance recorded |
| GPS centroid within `farBufferM` (100m) | Suspicious | Try again / Get help → correct code → **Present**¹ |
| GPS centroid beyond `farBufferM` | Far | Try again / Get help → correct code → **Under review** |
| No usable GPS fix at all | Unknown | Try again / Get help → correct code → **Under review** |

¹ Only while `suspiciousBandAutoPass` is on (the default). Turning it off routes this
band to review as well.

## Why the client is never told its band

The server answers `status: "collecting"` for **both** "still gathering fixes" and
"gathered enough, but you are not in a passing band". A modified client therefore cannot
learn how far out it is, and the suspicious/far distinction stays server-side until a
code is actually submitted. The only place the difference becomes visible is the outcome
after submitting the code, which is unavoidable — and by then the record already exists.

## Why `unknown` exists

A centroid built entirely from very inaccurate fixes says nothing useful. If no
contributing fix beat `ACCURACY_CEILING_M` (75m), the attempt bands as `unknown` rather
than being trusted — a ±200m "fix" sitting 40m from the building must not silently pass
as `near`. `unknown` routes to review, never to a pass. The same band applies when a
student produced no fix at all (location denied, no provider, no lock).

## Verdict retention

The band from the automatic attempt has to outlive the attempt itself: the GPS fix
buffer drops anything older than 90 seconds, and by the time a student reads the failure
screen, asks the lecturer, and types 8 digits, their fixes are long gone. So the verdict
(band, centroid, distance) is stored separately for 10 minutes in
`services/attemptVerdict.service.js`.

Like the OAuth exchange-code store, the sign-in nonce store, and the GPS fix buffer
itself, this is in-memory and single-process.

## Upgrades

A genuine automatic pass always overwrites a non-present record. A student who was sent
to review — or even rejected — and then actually walks into the room can fix it
themselves by checking in again. Nothing else overwrites: resubmitting the code while
already under review is a no-op, not a second pending row.

## Peer seeding

Only students who heard the **lecturer's own primary token** are eligible to seed. A
GPS-passed student can be up to the near buffer away from the building, so
re-broadcasting the classroom token from their phone would push it well outside the room
and undermine the "BLE proves you are in the room" premise the top of the decision table
rests on. A student who heard a *seeder* rather than the lecturer is excluded for the
same reason, one hop further out — which is why `verifyToken` reports which pool row
matched.

Among eligible students, real seeders and decoys get identical window durations and
identical UI, so nobody can tell which they were given. A GPS-passed student getting no
window at all reveals nothing they did not already know: their own device knows it never
heard a token.

## Admin controls

| Setting | Default | Effect |
|---|---|---|
| `bleEnabled` | true | The one kill switch. Off stops lecturer broadcasts, student scanning, and seeding. GPS has no equivalent — every session depends on it. |
| `nearBufferM` | 50 | Auto-pass radius, meters. |
| `farBufferM` | 100 | Outer radius, meters. Must be ≥ `nearBufferM`. |
| `suspiciousBandAutoPass` | true | Whether a correct code between the radii passes outright or goes to review. |
| `seedRate` | 0 | Target concurrent seeders; 0 disables seeding. |
| `seedWindowMs` | 60000 | Seeder **and** decoy window length. |

A note on the default: GPS is routinely accurate to only 20–50m indoors, so a tight
`nearBufferM` pushes genuinely-present students into the code path. 50m is a deliberate
compromise, not a precision claim.

## Session configuration

A session has no verification field. What the lecturer chooses is:

- **Buildings** — mandatory, at least one. Without a polygon GPS has nothing to measure
  against and every student would land in the review queue.
- **Code rotation** — whether the 8-digit code rotates on an interval, and how fast.
  The code itself always exists; there is no enable switch.

## Lecturer review

`under_review` submissions appear in the session card while the lecture is running, with
**Mark present** / **Reject** per student. The queue shows identity and submission time
and deliberately **not** the distance band or method: the question being asked is "was
this person actually in my lecture", which the lecturer can answer from the room. A
distance readout would only invite rubber-stamping a number they cannot check.

Rejection sets `status: 'rejected'` rather than deleting the row, so the decision is
auditable and a student cannot retry the code to get a fresh pending record.

## What stays server-internal

`method`, `band`, `seedRelayed`, and `centroid` are audit fields. They never appear in
the attendance matrix, the CSV export, or any student-facing payload. The matrix exposes
`status` only (`present` / `under_review` / `rejected`), because the lecturer has to act
on it.

## Known limits

- The 50–100m band with `suspiciousBandAutoPass` on is the main abuse surface: a student
  in the canteen who has the code from a group chat passes silently. Mitigations in place
  are the audit fields, the per-(student, session) attempt cap (5 tries / 5 min, then a
  2-minute lockout), and code rotation. The switch exists so this can be tightened after
  observing real use.
- BLE range is extended deliberately by seeding, so "BLE == in the room" is approximate.
  Restricting seeding to primary-verified students bounds the chain to one hop.
- All four in-memory stores block horizontal scaling.
