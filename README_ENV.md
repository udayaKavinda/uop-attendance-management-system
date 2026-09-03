# Production environment

Production runs Express from `/opt/attendance/app/server`. Nginx terminates TLS and
proxies the public host to Node on `127.0.0.1:5000`.

Express serves everything, including the iOS web client's static bundle at `/app` (built
from `web/`, see [web/README.md](web/README.md)). Nginx holds no document root: an older
config pointed one at `/opt/attendance/app/build`, left over from a React SPA that no
longer exists, and `location / { try_files $uri /index.html; }` against that missing
directory returned **500 on every unproxied path**, the bare `/` included. The live
config now proxies `/` to Node like every other prefix, matching
[deploy/nginx-app-domain.conf](deploy/nginx-app-domain.conf).

Two consequences worth remembering when editing that file:

- Nginx globs `sites-enabled/*`, so a backup left beside the config is **loaded as
  config** and fails the next reload with a duplicate-upstream error. Keep backups in
  `/etc/nginx/backups/`.
- Always `sudo nginx -t` before `sudo systemctl reload nginx`.

## Environment variables

```dotenv
NODE_ENV=production
TZ=Asia/Colombo
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/attendance
APP_BASE_URL=https://attendance.eng.pdn.ac.lk
CORS_ORIGINS=https://localhost
SESSION_SECRET=replace-with-a-long-random-value
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
SESSION_EXPIRE_JOB_MS=60000
```

- `SESSION_SECRET` is mandatory in production; the process exits at boot without it.
- `TZ` controls every weekly window and attendance date. The server safely defaults to
  `Asia/Colombo`, but production should set it explicitly.
- `APP_BASE_URL` builds the Google OAuth callback.
- `MONGO_URI` above is only the local-development shape. **Production points at a
  MongoDB Atlas cluster, not the VM's own `mongod`** — that box also runs a local
  MongoDB, so anyone inspecting `mongodb://127.0.0.1:27017/attendance` there is reading
  a different, near-empty database and drawing the wrong conclusion. Read the live
  `MONGO_URI` from `/opt/attendance/app/.env` before touching production data.
- `CORS_ORIGINS` is an **optional** comma-separated browser-origin allowlist; production
  does not currently set it, and `config/cors.js` falls back to `APP_BASE_URL` when it is
  absent. Set it only when a browser origin other than the app's own must be allowed.
  Native Android requests normally carry no `Origin` header at all.
- `SESSION_SECRET` has a development fallback (`'dev-only-secret'`), so a non-production
  process will start with a publicly known signing key. Production cannot: `config/env.js`
  exits at boot if it is unset.
- `FRONTEND_URL` and `REACT_APP_API_BASE` are present in the live `.env` and **read by
  nothing** — leftovers from the React SPA that was removed (see the nginx note at the top
  of this file). Safe to delete; kept here so the next person to read that file knows they
  are dead rather than assuming they matter.
- `CSP_REPORT_ONLY=1` downgrades the Content-Security-Policy to report-only. Useful for
  a few hours after a client change, to see violations in the browser console without
  breaking anything — but **production must not run with it set**, and it once sat there
  long enough that the carefully written policy was being ignored entirely. Unset it and
  restart to enforce; confirm with
  `curl -sI http://127.0.0.1:5000/api/healthz | grep -i content-security-policy`, which
  must print `Content-Security-Policy:` and not `-Report-Only`.
- `BLE_SECRET` is **no longer used and must not be re-added**. It was required at boot
  and read by nothing: BLE tokens are 8 random bytes from `crypto.randomBytes`, so they
  are unforgeable because they are unpredictable and checked against a live pool, not
  because anything is signed. Existing deployments can drop the line.

Keep `.env`, Android `local.properties`, `keystore.properties`, and signing keystores out
of Git.

## Install and verify manually

```bash
cd /opt/attendance/app
npm --prefix server ci
npm --prefix server test -- --runInBand
npm --prefix server prune --omit=dev
npm --prefix web ci --include=dev
npm --prefix web run build
sudo systemctl restart attendance
curl -fsS http://127.0.0.1:5000/api/healthz
curl -fsS -o /dev/null http://127.0.0.1:5000/app/
```

`--include=dev` is required for the web build, not optional: production sets
`NODE_ENV=production`, which makes npm skip devDependencies — and the whole build
toolchain (typescript, vite) lives there. Only built output is served, so nothing
dev-only reaches the bundle. Skipping the web build entirely is safe: `/app` then answers
503 and the API is unaffected.

The systemd unit should use `WorkingDirectory=/opt/attendance/app`, load the root `.env`,
and execute `/usr/bin/node server/src/server.js`.

## Automated production deployment

`.github/workflows/deploy.yml` deploys **main only** using the existing self-hosted
`attendance-prod` runner. It does not start GitHub-hosted runners or require hosted-runner
billing. The deployment:

1. Syncs the production checkout to `origin/main` while preserving `.env`.
2. Checks the server entry-point syntax and installs production dependencies.
3. Builds the web client and asserts `web/dist/index.html` exists.
4. Restarts the service and performs a local health check.
5. Automatically resets to the previous Git revision, rebuilds, and restarts if health
   fails. The web rebuild matters on rollback too: `web/dist` is untracked, so
   `git reset` leaves the failed deploy's bundle behind.

The web steps run *before* the restart, so a failing build leaves the previous release
running rather than taking the site down.

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
