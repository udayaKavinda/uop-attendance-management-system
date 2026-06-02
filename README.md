# UOP Attendance Management System

Role-based application for lecture attendance at the University of Peradeniya. Students mark attendance for **live** sessions by scanning a **rotating BLE token** broadcast from the classroom Bluetooth beacon; **lecturers** and **admins** manage courses, sessions, and reporting.

> **Branch:** `capacitor-bluetooth` — the React web app is wrapped with **Capacitor** so it can be built and installed as a native **Android APK**. The student BLE scan uses the native `@capacitor-community/bluetooth-le` plugin on Android (no browser dialog, works on all Android apps) and falls back to Web Bluetooth on plain browsers. See [Building the Android App](#building-the-android-app) below.
>
> **Web-only branch:** `feature/bluetooth` — identical server and UI, but no Capacitor; Web Bluetooth (Chrome on Android) only.

**Repository type:** private application (`package.json` → `"private": true`). No `LICENSE` file — treat usage and distribution as defined by your institution.

---

## Purpose

- Give students a single place to record attendance when a session is **actively running** (same calendar day and clock time as the session slot).
- Tie attendance to **verified identity** (Google OAuth + server session) and a **rotating BLE token** broadcast by the classroom Bluetooth beacon.
- Let staff create and operate sessions, control BLE broadcasting, export matrices, and maintain the lecturer directory.

---

## Core features

| Area | Capabilities |
|------|----------------|
| **Students** | Google sign-in; pick a **running** course; tap **📡 Scan for Bluetooth Attendance**. On the **native Android app** (this branch): `BleClient.requestLEScan` scans directly for the `UOP-XXXXXXXX` beacon — no device picker dialog. In a **browser**: Web Bluetooth picker (Chrome on Android only). Either path reads the rotating 8-byte token from manufacturer data (`0xFFFF`) and posts to `/api/bluetooth-attendance`. |
| **Lecturers** | Staff console: assigned courses, session CRUD, **BLE broadcasting control** (start/stop per session card), live PIN display, attendance matrix export, projector view, and live attendance gating via the blinking **Live** badge. |
| **Admins** | Everything lecturers can do for any course, plus lecturer directory and multi-lecturer course assignment. |
| **System** | In-memory rotating BLE token per session (`bluetoothCode.js`, **15 s** rotation via `setInterval`); session auto-deactivation for non-recurring sessions via background job; date-sensitive keys use host-local Y-M-D. |

---

## Contributing

1. Work on a feature branch; keep changes focused.
2. After changing frontend code, run `npm run cap:sync` to keep the Android project in sync.
3. Run `npm run build` before sharing frontend changes; `node --check server/index.js` after server edits.
4. Run `npm run test:server` to verify the BLE route tests pass.
5. Update this README when adding env vars, routes, or auth behavior.
