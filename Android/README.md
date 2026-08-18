# UOP Attendance Android App

Native Kotlin/Jetpack Compose client for students, lecturers, and administrators. The
production API base is `https://attendance.eng.pdn.ac.lk`; there is no WebView application
or React client.

## Roles and navigation

### Student

- Signs in with Google Credential Manager; browser OAuth is the fallback.
- Sees campus-wide courses with a session running now (the project has no enrolment data
  source or membership filter).
- The running-course payload determines `bluetooth`, `geofence`, or `both` behavior.
- May submit an enabled lecturer manual code at any time; doing so stops the automatic
  attempt and submits immediately.
- After acceptance, a capable/authorized device may receive a real or decoy peer-seeding
  window with indistinguishable UI.

### Lecturer

Tabs: **Courses**, **Create session**, and **Sessions**. Lecturers manage only courses they
own, create sessions using globally enabled verification policies, select multiple active
buildings through a searchable dropdown, broadcast for BLE-compatible sessions, control
manual codes, and open attendance reports.

### Administrator

Tabs: **Courses**, **Create session**, **Sessions**, **Lecturers**, **Geofences**, and
**Settings**. Admins additionally manage course owners, the lecturer directory, building
polygons, verification allow switches, GPS buffers, peer-seeding parameters, and the
manual-code global kill switch.

## Attendance flows

### Bluetooth

1. Request BLE scan permission (`BLUETOOTH_SCAN`/`CONNECT` on Android 12+; precise
   location on older Android versions).
2. Verify Bluetooth and the Android 11-and-earlier Location-services prerequisite.
3. Resolve the live server target and scan for the rotating token for up to 30 seconds.
4. Submit through the unified attendance endpoint.

Lecturer broadcasting runs in a foreground service with a persistent notification, server
heartbeat, rotating 15-second token, student count, and remaining session time. The UI and
server both reject broadcast for GPS-only sessions.

### GPS geofence

1. Request precise location permission.
2. Stream high-accuracy fixes for up to 90 seconds.
3. Submit each fix; the server owns polygon/buffer/centroid acceptance.
4. Continue while the server returns `pending`; finish on `accepted` or a real error.

### Both

Bluetooth and GPS are independent concurrent alternatives. The app starts whichever paths
are available; GPS remains usable when Bluetooth is denied/off/unsupported, and Bluetooth
remains usable when precise location is unavailable. Either accepted response wins.

### Manual code and peer seeding

An 8-digit code is shown only when enabled globally and for the running session. It is not
blocked by an automatic scan. Student devices request `BLUETOOTH_ADVERTISE` with their
primary attendance permissions on Android 12+; denying it does not block attendance and
causes `canAdvertise=false` to be sent to the server. If advertising later fails, the app
relinquishes its server lease and waits out the same seeding/decoy UI window.

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

- Course and verification selectors use the active server data.
- Building selection is a searchable, multi-select dropdown with selected-color state and
  removable chips.
- The form scrolls on compact screens; the Create button remains part of the content and
  is enabled only when course, schedule, policy, and required buildings are valid.
- Time pickers emit strict zero-padded `HH:mm` values.
- Manual-code enable/rotation configuration is sent atomically in the create-session
  request; there is no second best-effort setup request.
- One-time sessions display and use the server's explicit occurrence date.
- Attendance matrix cells and CSV export use the compact generic present marker **P**.

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
`/api/admin/sessions` with broadcast and manual-code actions,
`/api/admin/lecturers`, `/api/admin/geofences`, and `/api/admin/settings`.

The server README is the authoritative request/response and access-control reference.

## Testing expectations

Every API DTO change must have a server contract test and a matching Android DTO update.
Before merging or deploying, run Android unit tests, lint, and debug assembly plus the full
server Jest suite. Production CI enforces both groups before syncing the server.
