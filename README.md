# UOP Attendance Management System

Attendance management consists of a native Android client and an Express/MongoDB API.
The legacy React web client has been removed.

## Repository layout

- `Android/` — native Android application
- `server/` — Express API, authentication, attendance logic, and tests
- `deploy/` — reverse-proxy configuration example
- `.github/workflows/deploy.yml` — production deployment workflow
- `assets/` — shared project artwork and documentation assets

## Server setup

```bash
npm --prefix server ci
npm --prefix server test
npm --prefix server start
```

The API listens on `PORT` (default `5000`). Do not commit `.env` files.
Important settings include `MONGO_URI`, `SESSION_SECRET`, `BLE_SECRET`,
`APP_BASE_URL`, `CORS_ORIGINS`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.

Nginx should proxy the public hostname to Express. The API provides `/api/*`,
`/auth/*`, `/privacy`, and `/delete`; no static SPA build is required.

See `server/README.md` for API details and `README_ENV.md` for deployment.
