# UOP Attendance Android App

Native Kotlin/Jetpack Compose client for students, lecturers, and administrators. The
production API base is `https://attendance.eng.pdn.ac.lk`; there is no WebView application
or React client.

## Roles and navigation

### Student

- Signs in with Google Credential Manager; browser OAuth is the fallback.
- Sees campus-wide courses with a session running now (the project has no enrolment data
  source or membership filter).
- Picks a lecture and presses **Check me in** — one button, one 90-second window, no
  method to choose. The running-course payload carries identity only.
- On failure: **Try again** (another window) or **Get help**, which asks for the
  lecturer's 8-digit code.
- Lands on exactly one outcome: present, submitted for review, or not approved.
- After acceptance, a capable/authorized device may receive a real or decoy peer-seeding
  window with indistinguishable UI.

### Lecturer

Tabs: **Courses**, **Create session**, and **Sessions**. Lecturers manage only courses they
own, create sessions (choosing buildings — mandatory — and code rotation), broadcast
Bluetooth while a session runs, reveal/pause/regenerate the attendance code, decide the
review queue, and open attendance reports.

### Administrator

Tabs: **Courses**, **Create session**, **Sessions**, **Lecturers**, **Geofences**, and
**Settings**. Admins additionally manage course owners, the lecturer directory, building
polygons, the Bluetooth kill switch, the two distance thresholds, whether the outer band
auto-passes on a correct code, and peer-seeding parameters.

## Attendance flow

One flow, both radios, 90 seconds:

1. Ask once for everything the window may need — BLE scan, precise location, and
   `BLUETOOTH_ADVERTISE` for seeding. Any subset may be denied; the window runs with
   whatever is left.
2. Ask the server whether a broadcast is even live (`/api/bluetooth-target`). If not, the
   whole window goes to GPS rather than splitting attention.
3. Run the available paths concurrently: scan for the rotating token, and stream
   high-accuracy fixes submitting each one.
4. **First success ends the window** — a student in the front row is not made to wait.
5. Anything other than `accepted` is treated as "keep trying", including the server's
   deliberately ambiguous `collecting`. The client is never told its distance band.
6. When the window elapses, offer Try again / Get help.

If neither radio is usable at all, the app skips straight to the help path rather than
failing silently.

Lecturer broadcasting runs in a foreground service with a persistent notification, server
heartbeat, rotating 15-second token, student count, and remaining session time. Both the
UI and the server refuse to broadcast while the global Bluetooth switch is off.

### Lecturer code and peer seeding

The 8-digit code exists for every session and appears in the session card during its
scheduled window. Students only ever see it asked for behind **Get help** — never on the
first screen, so it is an escalation path rather than a shortcut.

Student devices request `BLUETOOTH_ADVERTISE` with their attendance permissions on
Android 12+; denying it does not block attendance and causes `canAdvertise=false` to be
sent. If advertising later fails, the app relinquishes its server lease and waits out the
same seeding/decoy UI window so the visible duration never reveals the real role.

## Geofence map

`GeofenceMapScreen.kt` uses a native osmdroid `MapView` and OpenStreetMap tiles—no API key,
billing account, Google Maps SDK, or WebView. The initial camera is the Faculty of
Engineering, University of Peradeniya. Admins can pan/zoom, place polygon vertices,
undo/clear, name a building, save, rename, and delete. Only active buildings are returned
for session selection or server verification.

Network connectivity is required for uncached map tiles. The Android manifest includes
Internet/network-state permissions and the production network security policy is HTTPS
only.

## Session creation and reporting

- The course selector uses active server data. There is no verification selector.
- Building selection is a searchable, multi-select dropdown with selected-color state and
  removable chips, and is **required** — GPS has nothing to measure against without it.
- The form scrolls on compact screens; the Create button remains part of the content and
  is enabled only when course, schedule, and at least one building are valid.
- Time pickers emit strict zero-padded `HH:mm` values.
- Code rotation is sent atomically in the create-session request; there is no second
  best-effort setup request.
- One-time sessions display and use the server's explicit occurrence date.
- Attendance matrix cells and CSV use **P** for present and **?** for a submission still
  awaiting the lecturer's decision. Verification provenance is never exposed.

## Authentication

Primary native flow:

1. `GET /api/auth/google-nonce`.
2. Credential Manager account chooser using the Web OAuth client ID.
3. `POST /api/auth/google-id-token`; the server verifies token audience/signature and the
   nonce, then creates the normal cookie session.

If Credential Manager is unavailable, a Custom Tab runs `/auth/google`; a single-use
exchange code returns through `lk.ac.pdn.eng.attendance://oauth` and is consumed by
`POST /api/auth/exchange-code`.

The persistent cookie jar retains the Express session. Mutations include
`X-Requested-With: fetch` for CSRF enforcement. A `401` clears local auth state.

Set the same Google **Web** client ID used by the server in `Android/local.properties`:

```properties
GOOGLE_WEB_CLIENT_ID=1234567890-example.apps.googleusercontent.com
```

The ID is not a secret. Server `GOOGLE_CLIENT_ID` must match it.

## Build

Requirements: Android Studio/JDK 17 and an Android SDK with compile SDK 36.

```bash
./gradlew testDebugUnitTest lintDebug assembleDebug
```

App configuration: application id `lk.ac.pdn.eng.feats`, min SDK 24, target SDK 37,
version `1.3.0` (`versionCode 4`).

For a signed release, create the ignored `keystore.properties` described in the root
`README_ENV.md`. Use a keystore path valid on the machine performing the build.

## Source layout

```text
app/src/main/java/lk/ac/pdn/eng/feats/
├─ AttendanceApp.kt                 application/container
├─ MainActivity.kt                  activity entry
├─ ble/                             scanner, advertiser, permissions, foreground service
├─ location/GpsLocationSource.kt    precise fix Flow
├─ data/net/                        Retrofit API, DTOs, cookie/session handling
├─ data/repo/AppRepository.kt       ApiResult facade
└─ ui/
   ├─ auth/                         Credential Manager and OAuth fallback
   ├─ student/                      running-course attendance flows
   ├─ staff/                        dashboard, map, reports, ViewModels
   ├─ components/                   shared controls/cards/buttons
   └─ theme/                        typography, colors, shapes
```

## API endpoints used

Authentication: `/api/auth/google-nonce`, `/api/auth/google-id-token`,
`/api/auth/exchange-code`, `/api/me`, `/api/logout`, plus `/auth/google` fallback.

Student: `/api/courses/running`, `/api/attendance-status`, `/api/attendance`,
`/api/bluetooth-target`, and `/api/attendance/seed-token`.

Staff/admin: `/api/admin/courses`, course sessions and attendance matrix,
`/api/admin/sessions` with broadcast, lecturer-code, and review-queue actions,
`/api/admin/lecturers`, `/api/admin/geofences`, and `/api/admin/settings`.

The server README is the authoritative request/response and access-control reference.

## Testing expectations

Every API DTO change must have a server contract test and a matching Android DTO update.
Before merging or deploying, run Android unit tests, lint, and debug assembly plus the full
server Jest suite. Production CI enforces both groups before syncing the server.
