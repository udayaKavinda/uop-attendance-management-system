# UOP Attendance — Android App

Native Android client for the UOP Attendance Management System. It is the mobile
counterpart of the React web app and talks to the **same Express server**
(`../server`). It supports all three roles and both Bluetooth roles:

| Role | What they can do in the app |
|------|------------------------------|
| **Student** | Sign in with Google, pick a running course, **scan** for the classroom BLE signal, and record attendance. After a successful mark, **Mark another course** returns to the picker for the next lecture. |
| **Lecturer** | Manage own courses & sessions, activate/deactivate, and run the **attendance broadcast** during a session's scheduled window — one button that flips the server switch and advertises the rotating token from the phone. |
| **Admin** | Everything a lecturer can do, plus **lecturer-scoped course management** (search/filter by lecturer, create courses for them), searchable owner assignment (up to 5), lecturer directory CRUD, and the attendance matrix per course. |

The visual identity (UOP maroon `#7A1414` / gold `#C9A227`, accent purple
`#7B61FF`, the brand lockup, logo and photographic background) is ported from the
React app's `src/index.css`.

---

## Tech stack

- **Kotlin + Jetpack Compose + Material 3** (single-Activity, Compose Navigation)
- **Retrofit + OkHttp + Moshi** (reflection adapters) for networking
- **Persistent cookie jar** in **EncryptedSharedPreferences** — the server session
  (`attendance.sid`) survives app restarts
- **Coroutines + StateFlow + ViewModel** for state
- **Credential Manager** (`androidx.credentials` + `googleid`) for native **Sign in with Google**
- **Custom Tabs** (`androidx.browser`) for the browser sign-in *fallback*
- **android.bluetooth.le** for both **scanning** (central) and **advertising** (peripheral)

Package: `lk.ac.pdn.eng.feats` · `minSdk 24` · `targetSdk 37`.

---

## How auth works

Sign-in has **two paths**. Both end in exactly the same place: the server sets the
ordinary `attendance.sid` session cookie, and every later `/api/*` call is authenticated
by that cookie (plus `X-Requested-With`). Nothing downstream of sign-in differs.

### 1. Credential Manager — the primary path

Google's current recommended API, replacing both the legacy `GoogleSignInClient` and the
One Tap APIs. The account chooser is a **native system bottom sheet** — no browser, no
deep link, no page bounce.

1. The app asks the server for a single-use nonce (`GET /api/auth/google-nonce`).
2. `GoogleAuth.signIn()` builds a `GetSignInWithGoogleOption` with
   `serverClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID` and that nonce, then calls
   `CredentialManager.getCredential()`. `GetSignInWithGoogleOption` always shows the
   account chooser, matching the old flow's `prompt=select_account`.
3. Google returns a **`GoogleIdTokenCredential`** — a short-lived signed JWT with the
   nonce embedded.
4. The app `POST`s it to `/api/auth/google-id-token`. The server verifies the signature
   and audience with `google-auth-library`, checks `email_verified`, consumes the nonce,
   resolves the `Person`, and calls `req.logIn()`.
5. The session cookie is set **on that response**, so it lands in the persistent cookie jar.

The nonce makes a captured ID token useless to replay: it is single-use and expires in
5 minutes.

### 2. Custom Tab OAuth — the fallback

Kept deliberately, for three reasons: devices with **no Google account or outdated Play
services** (`NoCredentialException`), users whose Credential Manager misbehaves, and
**already-installed older app versions** that still use only this path. The login screen
always shows a *"Having trouble? Sign in with your browser"* link, so no one can be
locked out.

1. The app opens a **Chrome Custom Tab** (ephemeral session on Android 11+, share button
   off) to
   `https://attendance.eng.pdn.ac.lk/auth/google?returnTo=lk.ac.pdn.eng.attendance://oauth`.
2. The server redirects to Google with `prompt=select_account`.
3. After Google sign-in the server issues a one-time **exchange code** and redirects
   through `/auth/native-return` to `lk.ac.pdn.eng.attendance://oauth?code=…`.
4. `MainActivity`'s intent filter catches the deep link and hands the `code` to
   `MainViewModel`, which `POST`s it to `/api/auth/exchange-code`.
5. Same cookie outcome as above.

`lk.ac.pdn.eng.attendance://oauth` is listed in `NATIVE_OAUTH_RETURN_BASES` in
`server/src/utils/constants.js` (alongside a legacy `lk.uop.attendance://oauth` alias).
Do not change the app scheme without updating the server constant.

**Google account picker tip (browser path only):** on Google's screen, tap the **account
name/avatar row** to sign in — not the email address underneath (that line is sometimes a
`mailto:` link and can open the mail app). The Credential Manager sheet has no such quirk.

### One account, either path

Both paths resolve to the **same `Person` document**. The server's
`upsertGooglePerson()` (in `services/googleIdentity.service.js`) is shared by the Passport
verify callback and the ID-token route, and both key on Google's stable subject id — the
ID token's `sub` is the same value Passport stores as `profile.id`. A user who signed in
through the browser before this change is recognised, not duplicated.

### Sign-out

`logout()` clears the server session, the cookie jar, cached prefs, **and** Credential
Manager's remembered account (`clearCredentialState`), so the next sign-in shows the
chooser rather than silently reusing the last account.

---

## Server compatibility

The app was checked against the server's CORS, session, CSRF and rate-limit
configuration. Summary:

| Concern | Status | Why |
|--------|--------|-----|
| **CORS** | ✅ N/A | CORS is browser-enforced. OkHttp sends no `Origin` header, so the server's allow-list never blocks native requests. The OAuth Custom Tab navigates same-origin. |
| **Session cookie** | ✅ Works | `attendance.sid` is `httpOnly`, `secure=isProd`, `sameSite=none(prod)/lax(dev)`. OkHttp ignores SameSite; the persistent jar honors the `Secure` flag — so **dev over HTTP** and **prod over HTTPS** both work. Credential Manager changes nothing here: the cookie is still set on an OkHttp response. |
| **CSRF guard** | ✅ Satisfied | Every request carries `X-Requested-With`, which the server requires on mutating `/api/*` calls — including the new `POST /api/auth/google-id-token`. |
| **Rate limits** | ✅ Fine | Only `oauth` (20/min) and `bluetooth-attendance` (60/min) are limited; there is no global limiter, so the 10 s polling and 5 s broadcast re-fetch are unthrottled. The nonce + ID-token routes share the 20/min `oauthLimiter`, i.e. ~10 sign-in attempts per minute (two calls each). |

### ⚠️ Configuration this build requires

1. **Google Cloud — an Android OAuth client is now required.** Credential Manager will
   not return a token unless the Cloud project has an **Android** OAuth client whose
   package name (`lk.ac.pdn.eng.feats`) and **SHA-1 signing fingerprint** match the
   installed APK. Register the fingerprint for *every* keystore you ship or test with —
   debug, release (`keystore.properties`), and Play App Signing if enabled (take that
   SHA-1 from Play Console → Setup → App integrity).
   *This is a change: the browser-only flow did not need an Android client.*

2. **`GOOGLE_WEB_CLIENT_ID` must be set at build time** (see [Setup](#setup)). It is the
   **Web** client id, not the Android one — the Android client is only how Google
   authenticates the calling app. Left blank, the app still builds and silently uses the
   browser fallback.

3. **Server `GOOGLE_CLIENT_ID` must be that same Web client id**, since it is the audience
   the server validates the ID token against. A mismatch fails every native sign-in with
   `Invalid Google token` while browser sign-in keeps working — a useful diagnostic.

4. **Set `APP_BASE_URL` to `https://attendance.eng.pdn.ac.lk`** (must match the
   app's fixed `BuildConfig.DEFAULT_API_BASE`). Needed by the *browser fallback* only:
   if unset, the server redirects the Custom Tab directly to the custom scheme, which
   Chrome often blocks. With it set, OAuth routes through the `/auth/native-return`
   bounce page.

---

## Bluetooth attendance

The rotating session token (16 hex chars, rotates every **15 s** with a 2 s grace
window) is carried in a 128-bit **service UUID** with a fixed `UOPA` prefix:

```
554f5041-TTTT-TTTT-TTTT-TTTT00000000      (T = token hex)
```

This packing is implemented in `ble/BleUuid.kt`, an exact mirror of the web app's
`src/utils/bleToken.js` (unit-tested in `BleUuidTest.kt`).

- **Student (scan):** the lecture-attendance card is **vertically centred** on tall
  screens; the copyright footer stays **pinned at the bottom**. The running-courses
  list refreshes every 10 s. Pick a course, then tap scan — a preflight runs first
  (runtime permission → Bluetooth on → on API 30 and below the system **Location**
  toggle, which BLE scan requires even after location permission is granted → scanner
  ready). API 31+ requests `BLUETOOTH_SCAN`/`CONNECT` only (no location). Denied
  permission shows an API-appropriate message; Location off opens system Location
  settings. The screen is kept on for the duration of the scan. Then `BleScanner` scans
  with a service-UUID filter matching the fixed `UOPA` prefix (the rotating token bytes are
  masked out, so it keeps working with the screen off), recovers the token, and submits via
  `POST /api/bluetooth-attendance`. The student scan times out after 30 s if no beacon is
  seen. On success, **Mark another course** returns to the picker.
- **Lecturer (broadcast):** one **"Start attendance broadcast"** button per session,
  shown **only while that session is inside its scheduled time window** (matches
  `GET /api/admin/sessions/running`). Outside the window the card explains that
  broadcast is not available yet.
  It runs a preflight (peripheral support → advertise permission → system Bluetooth
  toggle; each failure surfaces a specific message and the server is never touched),
  then flips the server's single `broadcasting` switch (`PATCH …/broadcast {on:true}`)
  and hands off to a **foreground service** (`BroadcastService`, type
  `FOREGROUND_SERVICE_CONNECTED_DEVICE`) that re-fetches `GET …/broadcast` every 5 s
  and re-advertises via `BleAdvertiser` so the token stays valid across the 15 s
  rotation. Requires BLE peripheral mode (`isMultipleAdvertisementSupported`).

  **Notification:** titled with the session itself (e.g. "CS101 MON 08:00-10:00"),
  its body updates on every poll with a live count — "4 students marked · 12m left" —
  pulled from the same `GET …/broadcast` response, plus a **Stop broadcast** action
  button that closes the radio *and* the server flag directly from the notification
  shade (no need to reopen the app). This is deliberate: Play's foreground-service
  policy for `TYPE_CONNECTED_DEVICE` requires the task to be "noticeable to the user,"
  so the notification shows real, continuously-updating progress rather than a static
  "broadcasting…" label. The raw rotating token and its countdown are **not** shown
  anywhere in the UI — they're an internal implementation detail, not something a
  lecturer needs to see. The same live count + pulsing **ON AIR** indicator is mirrored
  on the dashboard's session card.

  The 5 s poll doubles as the server **heartbeat**: if the phone dies, the server
  rejects students within ~30 s and sweeps the flag off. If Bluetooth is turned off
  in Quick Settings mid-broadcast, the service detects it, turns the server switch
  off, and reports "Broadcast stopped: Bluetooth was turned off." On dashboard load,
  a session the server still marks as broadcasting is **auto-resumed** from this
  phone (silent preflight) — or turned off on the server with a message if the phone
  can't broadcast. There is no separate pause: stopping the broadcast *is* closing
  attendance, and the button is ON only while this phone is actually on the air.
  The Sessions tab also nudges the lecturer to exempt the app from battery
  optimization (`ble/BatteryGuard.kt`), since some OEMs kill background foreground
  services aggressively enough to interrupt a broadcast.

---

## Staff / admin dashboard

Single Compose screen (`StaffDashboardScreen`) for lecturers and admins. Tabs: **Courses**,
**Create session**, **Sessions**, and (admin only) **Lecturers**.

### Admin — Courses tab

- **Lecturer filter** at the top: search by name or email (`GET /api/admin/lecturers?q=`),
  select one lecturer to filter the course list to their courses (clear to show all).
- **Add course** requires a selected lecturer; the new course is created with that
  lecturer as the initial owner (`lecturerIds` on `POST /api/admin/courses`). No owner
  checkboxes on the create form — add more owners from the course card afterward.
- **Course card:** tap the title area for the attendance matrix; **Owners** / **Disable** /
  **Enable** / **Delete** are separate action buttons (Disable no longer conflicts with
  the card tap). Disabled courses show a badge.
- **Owners dialog:** search lecturers, tap to add (up to 5), removable chips, save via
  `PATCH …/assign-lecturer`.

### Lecturer role

Same Courses / Create session / Sessions tabs but **no** lecturer filter, **no** Owners UI,
and the server auto-assigns the creating lecturer as sole owner on course create.

### Create session tab

- Course and day dropdowns; **Start** and **End** use Material 3 **time pickers** (24-hour
  `HH:mm`, validated server-side). Recurring checkbox unchanged.
- The form is vertically scrollable on compact phones, so verification/manual-code
  options and the **Create session** button remain reachable regardless of screen height.

### Admin — Geofences tab

- Uses a native **osmdroid MapView** with OpenStreetMap tiles (no API key or WebView).
  Tap to add polygon vertices, undo/clear the draft, and save a named building. Existing
  buildings are drawn on the same map and the camera fits their combined bounds. With no
  saved buildings, the initial camera is fixed on the Faculty of Engineering, University
  of Peradeniya (`7.25439, 80.59169`) rather than the device's last-known location.

---

## Setup

### Server

The app talks to **`https://attendance.eng.pdn.ac.lk`** only (baked into
`BuildConfig.DEFAULT_API_BASE` in `app/build.gradle.kts`). The production server
must set `APP_BASE_URL` to the same origin, set `GOOGLE_CLIENT_ID` to the Web OAuth
client id, and whitelist the native OAuth return scheme in `NATIVE_OAUTH_RETURN_BASES`.

> **Google Cloud console.** Two clients are needed now:
>
> - **Web client** — its id goes in *both* `GOOGLE_WEB_CLIENT_ID` (app) and
>   `GOOGLE_CLIENT_ID` (server). Its authorized redirect URI is the server's
>   `/auth/google/callback`, used by the browser fallback.
> - **Android client** — package `lk.ac.pdn.eng.feats` plus the SHA-1 of every
>   signing key you use. It has no id to copy anywhere; its only job is to let Google
>   verify the app requesting the token. **Credential Manager fails without it.**

### App

1. Set the Web client id. In `Android/local.properties` (gitignored, machine-local):

   ```properties
   GOOGLE_WEB_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
   ```

   `gradle.properties` works too, or `-PGOOGLE_WEB_CLIENT_ID=…` on the command line.
   The value is **not a secret** — it ships inside every copy of the app.

2. Open the `Android/` folder in **Android Studio** (Ladybug or newer) and let it
   sync Gradle. The toolchain is pinned in `gradle/libs.versions.toml`
   (AGP 9.2.1, Kotlin 2.2.20, Compose BOM 2024.12.01, androidx.credentials 1.5.0);
   if your installed Studio/SDK differs, accept its suggested version bumps during sync.
3. Run on an emulator or device. For the native sheet the target needs **Google Play
   services** and at least one Google account added; a Play-less AOSP image falls back
   to the browser path (which is the intended behaviour, not a bug).

> All API traffic is HTTPS-only (`res/xml/network_security_config.xml`).
> BLE advertising and reliable scanning generally require a **physical device**.

---

## Project layout

```
app/src/main/java/lk/ac/pdn/eng/feats/
├─ AttendanceApp.kt            Application + manual service locator (AppContainer)
├─ MainActivity.kt             Compose host + OAuth deep-link capture
├─ ble/
│  ├─ BleUuid.kt               token <-> service-UUID packing (mirrors bleToken.js)
│  ├─ BleScanner.kt            central: scan -> Flow<token>
│  ├─ BleAdvertiser.kt         peripheral: advertise rotating token
│  ├─ BroadcastService.kt      foreground service: poll+advertise loop, BT-off watch, preflight
│  ├─ BlePermissions.kt        per-API-level permission sets
│  └─ BatteryGuard.kt          battery-optimization exemption check/nudge for reliable broadcasting
├─ data/
│  ├─ net/                     ApiService, DTOs, ApiResult, cookie jar, network module
│  ├─ prefs/SessionPrefs.kt    encrypted user / cookie store
│  └─ repo/AppRepository.kt    ApiResult facade over the API
└─ ui/
   ├─ theme/                   Color / Type / Shape / Theme (web palette)
   ├─ components/              cards, buttons, fields, banners, badges, empty/loading states
   ├─ Vm.kt                    AndroidViewModel.container DI helper
   ├─ auth/                    MainViewModel (session), LoginScreen,
   │                           GoogleAuth (Credential Manager), OAuth (browser fallback)
   ├─ student/                 LectureEntry (scan + record)
   ├─ staff/                   StaffViewModel/Dashboard (lecturer filter, owners search, time pickers, broadcast) + matrix
   └─ AppRoot.kt               session-gated navigation
```

---

## Endpoints used

Auth: `GET /api/auth/google-nonce`, `POST /api/auth/google-id-token` (native path),
`POST /api/auth/exchange-code` (browser fallback), `GET /api/me`, `POST /api/logout`.
Student: `GET /api/courses/running`, `GET /api/attendance-status`,
`GET /api/bluetooth-target`, `POST /api/bluetooth-attendance`.
Staff: `GET/POST /api/admin/courses`, `…/assign-lecturer`, `…/disable|enable`,
`DELETE …/courses/:id`, `GET/POST …/courses/:id/sessions`,
`…/courses/:id/attendance-matrix`, `GET /api/admin/sessions`,
`GET /api/admin/sessions/running`, `…/sessions/:id/activate|deactivate`,
`PATCH/GET …/sessions/:id/broadcast` (single switch + token poll/heartbeat),
`…/sessions/:id/attendance`, and (admin) `GET/POST/PATCH/DELETE /api/admin/lecturers`.

---

## Notes & limitations

- **Sign-in requires Play services for the native sheet.** Credential Manager routes
  through `credentials-play-services-auth`. Any `GetCredentialException` (including
  `NoCredentialException`) is treated as *unavailable*, not fatal — the browser link on
  the login screen remains the guaranteed way in. A user cancelling the sheet shows no
  error at all.
- **`minSdk 24` is unaffected**; androidx.credentials supports API 21+ and the Play
  services backend covers API 23+.
- **Release builds are minified** (`isMinifyEnabled = true`), so `proguard-rules.pro`
  keeps `androidx.credentials.**` and the googleid classes — credential providers are
  resolved reflectively and would otherwise be stripped.
- **Student flow:** one attendance record per course/session/day on the server; the
  app lets students chain multiple courses in one sitting via **Mark another course**
  without signing out.
- **Staff broadcast:** the Android UI only offers start while the session is in its
  scheduled window; the server enforces the same rule on `PATCH/GET …/broadcast`.
- **Google Play FGS declaration:** `BroadcastService` uses
  `FOREGROUND_SERVICE_CONNECTED_DEVICE`, declared in Play Console under use case
  **"Continuous data transfer to an external device"** — the lecturer's phone
  continuously advertises a rotating BLE token to nearby student phones while
  backgrounded. The notification's live "students marked" count + time-remaining and
  its Stop action exist specifically to satisfy the policy's "noticeable to the user"
  requirement; keep them if the service is ever refactored, or the declaration review
  may need to be revisited.
- **Disable/enable course:** the app expects `{ success: true }` from those endpoints
  (full course body is optional); the server populates `lecturers` when a course object
  is returned.
- The attendance matrix offers **Share CSV** (via the Android share sheet) rather
  than the web app's `.xlsx` export.
- Light theme only, matching the web app.
- Identifier convention matches the API: `studentId`/`lecturerId` carry the
  Person `_id`; the matrix uses a separate `displayId` for its export column.
- Inter font is not bundled; the platform sans-serif is used. Drop Inter `.ttf`
  files into `res/font` and point `Type.kt` at them to match the web exactly.
