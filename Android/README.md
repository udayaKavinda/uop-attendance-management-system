# UOP Attendance — Android App

Native Android client for the UOP Attendance Management System. It is the mobile
counterpart of the React web app and talks to the **same Express server**
(`../server`). It supports all three roles and both Bluetooth roles:

| Role | What they can do in the app |
|------|------------------------------|
| **Student** | Sign in with Google, pick a running course, **scan** for the classroom BLE signal, and record attendance. |
| **Lecturer** | Manage own courses & sessions, activate/deactivate, enable Bluetooth, **pause/resume** attendance, view the live roster, and **broadcast** the rotating token straight from the phone. |
| **Admin** | Everything a lecturer can do, plus course-owner assignment, lecturer management, and the attendance matrix per course. |

The visual identity (UOP maroon `#7A1414` / gold `#C9A227`, accent purple
`#7B61FF`, the brand lockup, logo and photographic background) is ported from the
React app's `src/index.css`.

---

## Tech stack

- **Kotlin + Jetpack Compose + Material 3** (single-Activity, Compose Navigation)
- **Retrofit + OkHttp + Moshi** (reflection adapters) for networking
- **Persistent cookie jar** in **EncryptedSharedPreferences** — the server session
  (`connect.sid`) survives app restarts
- **Coroutines + StateFlow + ViewModel** for state
- **Custom Tabs** (`androidx.browser`) for the Google OAuth handshake
- **android.bluetooth.le** for both **scanning** (central) and **advertising** (peripheral)

Package: `lk.ac.pdn.eng.attendance` · `minSdk 24` · `targetSdk 36`.

---

## How auth works (native OAuth, no server changes needed)

The server already ships a native-app OAuth path:

1. The app opens a **Custom Tab** to
   `<base>/auth/google?returnTo=lk.uop.attendance://oauth`.
2. After Google sign-in the server issues a one-time **exchange code** and
   redirects through `/auth/native-return` to the deep link
   `lk.uop.attendance://oauth?code=…`.
3. `MainActivity`'s intent filter catches the deep link and hands the `code` to
   `MainViewModel`, which `POST`s it to `/api/auth/exchange-code`.
4. The server sets the **session cookie (`attendance.sid`) on that response** —
   which the app's own OkHttp client makes — so the cookie lands in the persistent
   cookie jar. Every later `/api/*` call is authenticated by that cookie (plus the
   `X-Requested-With` header the server's CSRF guard requires).

`lk.uop.attendance://oauth` mirrors `NATIVE_OAUTH_RETURN_BASES` in
`server/src/utils/constants.js` — do not change one without the other.

---

## Server compatibility

The app was checked against the server's CORS, session, CSRF and rate-limit
configuration. Summary:

| Concern | Status | Why |
|--------|--------|-----|
| **CORS** | ✅ N/A | CORS is browser-enforced. OkHttp sends no `Origin` header, so the server's allow-list never blocks native requests. The OAuth Custom Tab navigates same-origin. |
| **Session cookie** | ✅ Works | `attendance.sid` is `httpOnly`, `secure=isProd`, `sameSite=none(prod)/lax(dev)`. OkHttp ignores SameSite; the persistent jar honors the `Secure` flag — so **dev over HTTP** and **prod over HTTPS** both work. |
| **CSRF guard** | ✅ Satisfied | Every request carries `X-Requested-With`, which the server requires on mutating `/api/*` calls. |
| **Rate limits** | ✅ Fine | Only `oauth` (20/min) and `bluetooth-attendance` (60/min) are limited; there is no global limiter, so the 10 s polling and 5 s broadcast re-fetch are unthrottled. |

### ⚠️ Two things to configure on the server

1. **Set `APP_BASE_URL`** (done in step 1 above). If it is unset, the server
   redirects the Custom Tab *directly* to the `lk.uop.attendance://` scheme, which
   Chrome often blocks. With it set, OAuth routes through the reliable
   `/auth/native-return` bounce page.

2. **Production CSP blocks the auto-redirect script.** In production the server
   enforces `script-src 'self'`, so the inline script in `/auth/native-return`
   that auto-fires the deep link is blocked — sign-in still completes, but the
   user must tap the on-screen **"Tap here if you are not redirected"** link
   (a plain link, no script needed). In development (CSP report-only) it is
   seamless. To make it seamless in production, add a CSP nonce to that inline
   script, scope `script-src 'unsafe-inline'` to that one route, or move the
   redirect into a served `.js` file. (Server-side change; not required for the
   app to function.)

---

## Bluetooth attendance

The rotating session token (16 hex chars, rotates every **15 s** with a 2 s grace
window) is carried in a 128-bit **service UUID** with a fixed `UOPA` prefix:

```
554f5041-TTTT-TTTT-TTTT-TTTT00000000      (T = token hex)
```

This packing is implemented in `ble/BleUuid.kt`, an exact mirror of the web app's
`src/utils/bleToken.js` (unit-tested in `BleUuidTest.kt`).

- **Student (scan):** `BleScanner` runs an unfiltered low-latency scan, inspects
  every advertisement's service UUIDs, recovers the token, and submits it to
  `POST /api/bluetooth-attendance`. 30 s timeout.
- **Lecturer (broadcast):** `BleAdvertiser` advertises the current token as a
  service UUID. `StaffViewModel` re-fetches `…/bluetooth-broadcast` every 5 s and
  re-advertises so the broadcast token stays valid across the 15 s rotation.
  Requires a device that supports BLE peripheral mode
  (`isMultipleAdvertisementSupported`).

---

## Setup

### 1. Server

Run the Express server in `../server` and make sure its environment allows the
native return target. In the server `.env`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# Used to build the native-return bounce page:
APP_BASE_URL=http://10.0.2.2:5000      # or your machine's LAN URL / public URL
```

The custom scheme `lk.uop.attendance://oauth` is already whitelisted in the
server's `NATIVE_OAUTH_RETURN_BASES`.

> **Google Cloud console:** the OAuth client's authorized redirect URI is the
> server's `/auth/google/callback` (unchanged from the web app). The app never
> talks to Google directly — it only opens the server URL — so no Android OAuth
> client is required.

### 2. App

1. Open the `Android/` folder in **Android Studio** (Ladybug or newer) and let it
   sync Gradle. The toolchain is pinned in `gradle/libs.versions.toml`
   (AGP 9.2.1, Kotlin 2.1.0, Compose BOM 2024.12.01); if your installed
   Studio/SDK differs, accept its suggested version bumps during sync.
2. Set the server address: it defaults to `http://10.0.2.2:5000` (the emulator's
   alias for your computer's `localhost`). Change it any time on the login
   screen under **Server settings** — use your machine's LAN IP for a physical
   device, or an `https://` URL in production.
3. Run on an emulator or device.

> Cleartext HTTP is allowed **only** for `10.0.2.2` / `localhost` / `127.0.0.1`
> (see `res/xml/network_security_config.xml`). Production servers must use HTTPS.
> BLE advertising and reliable scanning generally require a **physical device**.

---

## Project layout

```
app/src/main/java/lk/ac/pdn/eng/attendance/
├─ AttendanceApp.kt            Application + manual service locator (AppContainer)
├─ MainActivity.kt             Compose host + OAuth deep-link capture
├─ ble/
│  ├─ BleUuid.kt               token <-> service-UUID packing (mirrors bleToken.js)
│  ├─ BleScanner.kt            central: scan -> Flow<token>
│  ├─ BleAdvertiser.kt         peripheral: advertise rotating token
│  └─ BlePermissions.kt        per-API-level permission sets
├─ data/
│  ├─ net/                     ApiService, DTOs, ApiResult, cookie jar, network module
│  ├─ prefs/SessionPrefs.kt    encrypted base-URL / user / cookie store
│  └─ repo/AppRepository.kt    ApiResult facade over the API
└─ ui/
   ├─ theme/                   Color / Type / Shape / Theme (web palette)
   ├─ components/              cards, buttons, fields, banners, badges, empty/loading states
   ├─ auth/                    MainViewModel (session), LoginScreen, OAuth launcher
   ├─ student/                 LectureEntry (scan + record)
   ├─ staff/                   StaffViewModel/Dashboard (courses, sessions, lecturers, broadcast) + attendance matrix
   └─ AppRoot.kt               session-gated navigation
```

---

## Endpoints used

Auth: `POST /api/auth/exchange-code`, `GET /api/me`, `POST /api/logout`.
Student: `GET /api/courses/running`, `GET /api/attendance-status`,
`GET /api/bluetooth-target`, `POST /api/bluetooth-attendance`.
Staff: `GET/POST /api/admin/courses`, `…/assign-lecturer`, `…/disable|enable`,
`DELETE …/courses/:id`, `GET/POST …/courses/:id/sessions`,
`…/courses/:id/attendance-matrix`, `GET /api/admin/sessions`,
`GET /api/admin/sessions/running`, `…/sessions/:id/activate|deactivate`,
`…/bluetooth/start|stop`, `…/bluetooth-broadcast`, `…/attendance-paused`,
`…/sessions/:id/attendance`, and (admin) `GET/POST/PATCH/DELETE /api/admin/lecturers`.

---

## Notes & limitations

- The attendance matrix offers **Share CSV** (via the Android share sheet) rather
  than the web app's `.xlsx` export.
- Light theme only, matching the web app.
- Identifier convention matches the API: `studentId`/`lecturerId` carry the
  Person `_id`; the matrix uses a separate `displayId` for its export column.
- Inter font is not bundled; the platform sans-serif is used. Drop Inter `.ttf`
  files into `res/font` and point `Type.kt` at them to match the web exactly.
