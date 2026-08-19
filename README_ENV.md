# Production environment

Production runs Express from `/opt/attendance/app/server`. Nginx terminates TLS and
proxies the public host to Node on `127.0.0.1:5000`; there is no SPA/static frontend.

## Environment variables

```dotenv
NODE_ENV=production
TZ=Asia/Colombo
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/attendance
APP_BASE_URL=https://attendance.eng.pdn.ac.lk
CORS_ORIGINS=https://localhost
SESSION_SECRET=replace-with-a-long-random-value
BLE_SECRET=replace-with-a-long-random-value
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
SESSION_EXPIRE_JOB_MS=60000
```

- `SESSION_SECRET` and `BLE_SECRET` are mandatory in production.
- `TZ` controls every weekly window and attendance date. The server safely defaults to
  `Asia/Colombo`, but production should set it explicitly.
- `APP_BASE_URL` builds the Google OAuth callback.
- `CORS_ORIGINS` is a comma-separated browser-origin allowlist. Native Android requests
  normally have no `Origin` header.

Keep `.env`, Android `local.properties`, `keystore.properties`, and signing keystores out
of Git.

## Install and verify manually

```bash
cd /opt/attendance/app
npm --prefix server ci
npm --prefix server test -- --runInBand
npm --prefix server prune --omit=dev
sudo systemctl restart attendance
curl -fsS http://127.0.0.1:5000/api/healthz
```

The systemd unit should use `WorkingDirectory=/opt/attendance/app`, load the root `.env`,
and execute `/usr/bin/node server/src/server.js`.

## Automated production deployment

`.github/workflows/deploy.yml` deploys **main only** using the existing self-hosted
`attendance-prod` runner. It does not start GitHub-hosted runners or require hosted-runner
billing. The deployment:

1. Syncs the production checkout to `origin/main` while preserving `.env`.
2. Checks the server entry-point syntax and installs production dependencies.
3. Restarts the service and performs a local health check.
4. Automatically resets to the previous Git revision and restarts if health fails.

Feature branches cannot deploy directly to the production runner.

## Android signing

Debug builds need no keystore. Signed releases require `Android/keystore.properties`:

```properties
UOP_KEYSTORE_PATH=C:/absolute/path/to/uop-attendance-upload.jks
UOP_KEYSTORE_PASSWORD=...
UOP_KEY_ALIAS=...
UOP_KEY_PASSWORD=...
```

Use a valid path on the current machine; never copy another developer machine's absolute
keystore path.
