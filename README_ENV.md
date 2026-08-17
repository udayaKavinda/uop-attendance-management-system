# Production environment

Production runs Express from `/opt/attendance/app/server`, with MongoDB locally.
Nginx terminates TLS and proxies all public routes to Node on `127.0.0.1:5000`.
There is no React build or frontend process.

## Environment

```dotenv
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/attendance
APP_BASE_URL=https://attendance.eng.pdn.ac.lk
CORS_ORIGINS=https://localhost
SESSION_SECRET=replace-with-a-long-random-value
BLE_SECRET=replace-with-a-long-random-value
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
```

`APP_BASE_URL` builds the OAuth callback. `CORS_ORIGINS` is a comma-separated
allowlist for browser/Capacitor origins. Native clients normally omit `Origin`.

## Install and verify

```bash
cd /opt/attendance/app
npm --prefix server ci --omit=dev
node --check server/src/server.js
sudo systemctl restart attendance
curl -fsS http://127.0.0.1:5000/api/healthz
```

For tests, use `npm --prefix server ci` and `npm --prefix server test`.

The systemd unit should use `WorkingDirectory=/opt/attendance/app`, load the
root `.env`, and run `/usr/bin/node server/src/server.js`. Nginx should proxy
the entire public host to port 5000 without a static root or SPA fallback.
