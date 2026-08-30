# Attendance Verification Design — Implemented System

Status: implemented. This document describes the system as built, not a proposal.

## The model in one paragraph

Every lecture session verifies attendance the same way. There is no per-session policy
to choose. When a student checks in, their phone spends up to 90 seconds listening for
the lecturer's Bluetooth beacon *and* streaming GPS fixes at the same time; either one
can pass them, and the first to succeed ends the window. If Bluetooth is off, the app
fires the system "turn on Bluetooth?" prompt (both on the first attempt and every
**Try again**) and gives the radio a brief moment to actually come on before the window
starts — GPS runs regardless of what the student picks, so the prompt never blocks or
delays it. If neither radio produces a pass, the student is offered **Try again**
(another 90 seconds) or **Get help**, which asks for the 8-digit code the lecturer reads
out. What that code grants depends on how far from the building the student's GPS put
them — close enough and it passes them outright, too far and the attempt is flagged for
whoever later reads the attendance export, not queued for anyone to act on.

## Explicit product boundaries

- Course discovery is campus-wide. No enrolment/registration source exists in this
  repository, so the server does not infer membership from course batch or email format.
- GPS verification is foreground and permission-based; the app does not continuously
  track students.
- In-memory nonce, GPS-fix, and attempt-verdict state assumes one server process. A
  shared store is required before horizontal scaling.

## Clients

Two student clients reach the same endpoints and the same verification logic:

| | Android app | Web client (`/app`) |
|---|---|---|
| Bluetooth proximity | yes | **no — no iOS browser can read a BLE beacon** |
| GPS geofence | yes | yes |
| Lecturer's code | yes | yes |
| Peer seeding | yes | never — see below |

The web client exists because iPhone and iPad students have no native app yet. Nothing in
this document changes for it: it submits the same `fix` and `code` payloads, gets the same
deliberately ambiguous `collecting`, and is banded by the same server logic. It simply has
one fewer way to pass, which is why it is offered to iOS only by default
(`webAllowNonIos`) — Android users have a client that can also hear the beacon.

Peer seeding is absent there by consequence, not omission: only students verified by a
**primary** BLE token are ever selected as seeders, so a GPS-verified student is passed
over on every platform, native app included.

That platform gate is a UX decision, not a security boundary — the browser decides by
reading its own user agent, which anyone can spoof. It does not need to be more: the web
client uses only paths the Android app already exposes, so nothing is reachable through it
that was not already reachable.

### Course registration

Optional on both clients: a student can register ahead of time for any unarchived course,
campus-wide (`GET /api/courses/catalog`, ignoring session state entirely — unlike
`/api/courses/running`). The registered set (`Person.registeredCourses`) has no effect on
verification; it only changes what the check-in search shows at rest. A registered course
that is also currently running pins to the top of the search without the student typing
anything; a course that is registered but not running still cannot be picked, same as
before registration existed. Typing anything drops the pinned list and searches normally.

## Decision table

Distances are measured from the edge of the session's building polygon and are
admin-configurable (defaults shown).

| Evidence gathered in the window | Result | Student sees |
|---|---|---|
| Valid BLE token received | **Present** | Attendance recorded |
| Within `nearBufferM` (50m) per the near-buffer logic | **Present** | Attendance recorded |
| Within `farBufferM` (100m) per the far-buffer logic | Suspicious | Try again / Get help → correct code → **Present** |
| Outside `farBufferM` per the far-buffer logic | Far | Try again / Get help → correct code → **Flagged**¹ |
| No usable GPS fix at all | Unknown | Try again / Get help → correct code → **Flagged**¹ |

¹ `suspicious` always auto-passes on a correct code now — there is no admin switch for
it. `far`/`unknown` never do; the attempt is written as a `flagged` attendance record
with a reason, visible only in the Excel export (see "Flagged records" below).

"Within `nearBufferM`" is deliberately not just "distance ≤ 50m" — see "Selectable
geofence logic" below for what decides it.

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

## Selectable geofence logic

`nearBufferM`/`farBufferM` are thresholds; what "within the buffer" *means* against
those thresholds is a separately selectable strategy per band
(`Settings.nearBufferLogic`/`farBufferLogic`), implemented in
`services/geofenceLogic.service.js`. The near band is always evaluated first — it's the
stronger claim — and the far band's strategy only runs if near didn't already pass.

| Strategy id | What it checks |
|---|---|
| `accuracy_weighted_centroid` (default) | Distance from the accuracy-weighted average of all surviving fixes. |
| `any_point_within` | Passes if the single closest fix lands inside the buffer. |
| `majority_points_within` | Passes if more than half the surviving fixes land inside the buffer. |
| `all_points_within` | Passes only if every surviving fix lands inside the buffer. |
| `median_distance` | The middle distance across all fixes — robust to one outlier fix either way. |
| `best_accuracy_fix` | Only the single most-precise fix's distance is checked; the rest are ignored. |

Every strategy shares the same upstream pipeline: the outlier-trimming pass
(`removeOutliersByMedianDistance`) and the `ACCURACY_CEILING_M` gate run first regardless
of which strategy is selected, so a strategy only ever sees fixes that already cleared
those two filters. If trimming leaves fewer than `MIN_FIXES` trustworthy fixes, the
attempt reports "not ready" and waits for more rather than banding on data it has already
judged unreliable.

`all_points_within` is a genuine footgun with real GPS: one stray reading out of ~30 fails
the whole attempt, so a student who never left the room can still be flagged. It is offered
for small, very tight geofences only, and its description in the admin dropdown says so.

Accuracy is normalised once (`normalizedAccuracy`) before either weighting or best-fix
selection. Android's `Location.getAccuracy()` returns `0.0` when `hasAccuracy()` is false,
so `0` means "unknown", never "perfect" — it is treated as a pessimistic 50 m in both
places. Without that, an accuracy-unknown fix was simultaneously the least-trusted input
to the centroid and "the most precise fix we have" for `best_accuracy_fix`.

## Verdict retention

The band from the automatic attempt has to outlive the attempt itself: the GPS fix
buffer drops anything older than 90 seconds, and by the time a student reads the failure
screen, asks the lecturer, and types 8 digits, their fixes are long gone. So the verdict
(band, centroid, distance) is stored separately for 10 minutes in
`services/attemptVerdict.service.js`.

Like the OAuth exchange-code store, the sign-in nonce store, and the GPS fix buffer
itself, this is in-memory and single-process.

## Upgrades

A genuine automatic pass always overwrites a `flagged` record — a student who was
flagged and then actually walks into the room can fix it themselves by checking in
again. A fresh `flagged` verdict also overwrites an existing `flagged` one, so the stored
reason/distance reflects the latest evidence gathered in the window rather than freezing
on the first fix that happened to flag. Nothing ever downgrades an existing `present`
record.

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
| `nearBufferM` | 50 | Near-band threshold, meters. |
| `farBufferM` | 100 | Far-band threshold, meters. Must be ≥ `nearBufferM`. |
| `nearBufferLogic` | `accuracy_weighted_centroid` | Strategy deciding "within `nearBufferM`" — see "Selectable geofence logic". |
| `farBufferLogic` | `accuracy_weighted_centroid` | Strategy deciding "within `farBufferM`" — see "Selectable geofence logic". |
| `seedRate` | 0 | Target concurrent seeders; 0 disables seeding. |
| `seedWindowMs` | 60000 | Seeder **and** decoy window length. |
| `webAllowNonIos` | false | Whether the browser client at `/app` serves non-iOS devices. A UX gate only — see "Clients". |

A note on the default: GPS is routinely accurate to only 20–50m indoors, so a tight
`nearBufferM` pushes genuinely-present students into the code path. 50m is a deliberate
compromise, not a precision claim.

## Session configuration

A session has no verification field. What the lecturer chooses is:

- **Buildings** — mandatory, at least one. Without a polygon GPS has nothing to measure
  against and every student would be flagged as `unknown` instead of passing.
- **Code rotation** — whether the 8-digit code rotates on an interval, and how fast.
  The code itself always exists; there is no enable switch.

## Flagged records

There is no lecturer review queue and no approve/reject action anywhere in the app. A
`far`/`unknown` **code submission** is written as `status: 'flagged'` directly — it is
neither present nor silently absent, just a record with a `reason` string
(`services/attendance.service.js`'s `reasonForFlag`) explaining why: a distance
("GPS location is 2.1km from the nearest session building.") for `far`, or a fixed
message for `unknown` (no usable fix, or every session building was deleted/deactivated
mid-lecture). The only place this becomes visible is the Excel attendance export
(`GET /admin/courses/:courseId/attendance-matrix.xlsx`,
`services/attendanceExport.service.js`): a flagged cell renders 'F' on a red fill with
the reason attached as a cell comment. The on-screen matrix and the JSON API expose
`status` only, same as `present`.

The student is shown **"Under review"** — "We couldn't verify that you were present in the
lecture room. Your attendance is now pending review by the lecturer." — worded as what to
expect rather than as a workflow — their attendance is with the lecturer, and there is
deliberately no invitation to dispute it, because nothing in the app can act on a dispute.
Both clients use the same wording.

**Raw GPS fixes never write anything for `suspicious`/`far`/`unknown`** — only an actual
"get help" code submission does. A student whose GPS never passes and who never types a
code leaves **no record at all**, exactly like a student who never checked in; nothing is
visible in the export for an attempt that was never escalated to the code.

## What stays server-internal

`method`, `band`, `seedRelayed`, and `centroid` are audit fields. They never appear in
the on-screen attendance matrix, the JSON API, or any student-facing payload. The matrix
exposes `status` only (`present` / `flagged`). `reason` is the one exception: it exists
specifically to be shown, but only inside the Excel export's cell comments — never in the
on-screen matrix or the JSON API.

## Known limits

- The 50–100m suspicious band always auto-passes on a correct code now — a student in the
  canteen who has the code from a group chat passes silently. Mitigations in place are
  the audit fields and code rotation; there is deliberately no per-student guess cap or
  lockout on the code endpoint (removed — see below).
- BLE range is extended deliberately by seeding, so "BLE == in the room" is approximate.
  Restricting seeding to primary-verified students bounds the chain to one hop.
- All in-memory stores block horizontal scaling.

## No guess cap on the "get help" code

Wrong-code submissions are rejected every time with the same plain 400, with no
per-(student, session) attempt limit and no lockout window — an earlier version of this
service capped it at 5 tries / 5 minutes before a 2-minute lockout
(`manualCode.service.js`'s `verifyAttempt`), but that has been removed entirely; only
`verifyCode` remains, a pure code check with no attempt state. Brute-forcing an 8-digit
code (100 million possibilities) inside a session's schedule window remains the practical
mitigation, alongside code rotation and the general endpoint rate limiter shared by the
rest of the API.
