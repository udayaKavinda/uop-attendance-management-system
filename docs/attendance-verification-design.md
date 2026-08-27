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
- In-memory nonce, code-attempt, GPS-fix, and attempt-verdict state assumes one server
  process. A shared store is required before horizontal scaling.

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
those two filters.

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
`far`/`unknown` attempt is written as `status: 'flagged'` directly — it is neither
present nor silently absent, just a record with a `reason` string
(`services/attendance.service.js`'s `reasonForFlag`) explaining why: a distance
("GPS location is 2.1km from the nearest session building.") for `far`, or a fixed
message for `unknown` (no usable fix, or every session building was deleted/deactivated
mid-lecture). The only place this becomes visible is the Excel attendance export
(`GET /admin/courses/:courseId/attendance-matrix.xlsx`,
`services/attendanceExport.service.js`): a flagged cell renders 'F' on a red fill with
the reason attached as a cell comment. The on-screen matrix and the JSON API expose
`status` only, same as `present`.

Critically, this record now gets written even when the student never falls back to the
lecturer's code at all — every GPS-evaluated `far`/`unknown` verdict is persisted the
moment it's reached, not just ones that reach the help-code path. Previously a student
whose GPS never passed and who never typed a code left **no record whatsoever**; now
their attempt is visible (flagged) in the export either way.

## What stays server-internal

`method`, `band`, `seedRelayed`, and `centroid` are audit fields. They never appear in
the on-screen attendance matrix, the JSON API, or any student-facing payload. The matrix
exposes `status` only (`present` / `flagged`). `reason` is the one exception: it exists
specifically to be shown, but only inside the Excel export's cell comments — never in the
on-screen matrix or the JSON API.

## Known limits

- The 50–100m suspicious band always auto-passes on a correct code now — a student in the
  canteen who has the code from a group chat passes silently. Mitigations in place are
  the audit fields, the per-(student, session) attempt cap (5 tries / 5 min, then a
  2-minute lockout), and code rotation.
- BLE range is extended deliberately by seeding, so "BLE == in the room" is approximate.
  Restricting seeding to primary-verified students bounds the chain to one hop.
- All four in-memory stores block horizontal scaling.
