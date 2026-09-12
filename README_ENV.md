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
- **Security headers come from the app, not from nginx — do not add them here.** The live
  site config used to carry `add_header Strict-Transport-Security "max-age=15552000"`,
  so every response went out with *two* HSTS headers: that one and the stronger
  `max-age=31536000; includeSubDomains; preload` from
  [server/src/config/security.js](server/src/config/security.js). RFC 6797 has the
  browser honour the first and ignore the rest, so the nginx line never actually took
  effect — it only made the live response disagree with the config under version
  control, and the two carried contradictory intent (six months, no preload, versus one
  year with it). The directive has been removed; production now returns exactly one
  HSTS header and it is the app's. Removing it was safe because nothing is inherited:
  a block with no `add_header` of its own inherits its parent's, and there are no
  `add_header` directives in `nginx.conf`, `conf.d/`, or `snippets/`. Change the policy
  in `security.js`, never in the site config.
- **A "backup" that is a symlink is not a backup.** `/etc/nginx/backups/` has held
  `attendance.eng.pdn.ac.lk.conf.bak-<date>` pointing at the live file, so restoring
  from it restores nothing. Harmless where it sits — nginx globs `sites-enabled`, not
  `backups` — but it is exactly the thing someone grabs mid-incident. Use `cp -a`.

## Environment variables

```dotenv
NODE_ENV=production
TZ=Asia/Colombo
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/attendance
APP_BASE_URL=https://attendance.eng.pdn.ac.lk
SESSION_SECRET=replace-with-a-long-random-value
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
```

Those eight are exactly what the live `/opt/attendance/app/.env` sets. Everything else the
server reads — `CORS_ORIGINS`, `SESSION_EXPIRE_JOB_MS`, `CSP_REPORT_ONLY`,
`CSP_EXTRA_CONNECT_SRC`, `MONGO_TEST_URI` — is optional, is **not** set in production, and
falls back to the default described below. Verify the real set without exposing any value:

```bash
sudo grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' /opt/attendance/app/.env | tr -d '='
```

- `SESSION_SECRET` is mandatory in production; the process exits at boot without it.
- `TZ` controls every weekly window and attendance date. The server safely defaults to
  `Asia/Colombo`, but production should set it explicitly.
- `APP_BASE_URL` builds the Google OAuth callback.
- `MONGO_URI` is the real production value, not a development placeholder:
  **production runs on the VM's own `mongod`**, standalone, on `127.0.0.1:27017`, database
  `attendance`. A MongoDB Atlas cluster also exists and has served production at times, but
  its role now is **testing only** — `uop_attendance_test` there is the base name the
  live-database suites derive their own databases from (`_schema`, `_gpsstate`, `_bands`;
  see `server/README.md`). Production data belongs on the VM.

  Because both are real and both hold plausible-looking data, never infer which one a box
  is using. Ask the process:

  ```bash
  sudo ss -tnp | grep "pid=$(pgrep -f 'node server/src/server.js')" | awk '{print $5}' | sort -u
  ```

  `127.0.0.1:27017` means the local mongod, which is correct. A remote address means it is
  on Atlas and should be moved back.

  **If you ever do point it at Atlas, get the database name into the path, before the
  query string.** A URI ending `...mongodb.net/?appName=Cluster0/attendance` connects
  successfully and silently uses the driver's default database, `test` — which looks
  exactly like a working deploy against an empty system.
  It must read `...mongodb.net/attendance?appName=Cluster0`.

  Two consequences of being standalone rather than a replica set. **Transactions and
  change streams do not work** — neither is used anywhere in `server/src`, which is why
  running standalone is viable, so keep it that way or the database has to become a
  replica set. And **nothing snapshots this automatically**: Atlas did, a standalone
  `mongod` does not, and there is no `mongodump` schedule in `/etc/cron.d` or root's
  crontab.

  That last point has teeth now in a way it did not when it was first written, because
  **production holds a real semester**. `/var/lib/mongodb` on this single VM is the only
  copy of every attendance record, and attendance is the one thing here that cannot be
  reconstructed from anywhere else: a course can be retyped and a geofence redrawn; who
  sat in a lecture three weeks ago cannot.

  ```bash
  sudo mkdir -p /var/backups/mongo
  # nightly dump, 14 days retained
  echo '0 2 * * * root mongodump --uri="mongodb://127.0.0.1:27017/attendance" --archive=/var/backups/mongo/attendance-$(date +\%F).gz --gzip && find /var/backups/mongo -maxdepth 1 -mtime +14 -type f -delete' \
    | sudo tee /etc/cron.d/attendance-mongo-backup
  ```

- **Moving between the two never migrates data as a side effect.** Editing `MONGO_URI`
  points the app at a different set of collections, nothing more; the semester roster
  moves only when someone runs `mongodump`/`mongorestore` deliberately. Both databases
  have held a plausible copy at different times, which is exactly why the socket check
  above matters more than any document.

  A fresh production database cannot do anything until it is bootstrapped, in this order:

  1. The admin creates itself at boot, from `BOOTSTRAP_ADMIN_EMAIL` in
     [server/src/utils/constants.js](server/src/utils/constants.js). It is a hard-coded
     constant rather than an environment variable, so there is nothing to set and no way
     to be locked out — but equally, **changing it takes a deploy, not an `.env` edit**.
     Check the value in the source before assuming which account will come up as admin,
     and remember the running server holds whatever was compiled in at its last deploy.
  2. `settings` self-creates with defaults (50 m near, 100 m far, BLE on).
  3. **Every other account signs in as a `student`** — `googleIdentity.service.js`
     assigns that role to every new person — so each lecturer has to be promoted by the
     admin before they can own a course.
  4. **No session can be scheduled until a geofence exists.** Session creation requires
     at least one building, geofence creation is `requireAdmin`, and the admin UI is
     Android-only. Draw a building first or nothing else can proceed.
- `CORS_ORIGINS` is an **optional** comma-separated browser-origin allowlist; production
  does not currently set it, and `config/cors.js` falls back to `APP_BASE_URL` when it is
  absent. Set it only when a browser origin other than the app's own must be allowed.
  Native Android requests normally carry no `Origin` header at all.
- `SESSION_SECRET` has a development fallback (`'dev-only-secret'`), so a non-production
  process will start with a publicly known signing key. Production cannot: `config/env.js`
  exits at boot if it is unset.
- `FRONTEND_URL` and `REACT_APP_API_BASE` were leftovers from the React SPA that was
  removed (see the nginx note at the top of this file), read by nothing. They have since
  been deleted from the live `.env` and are recorded here only so that finding them in an
  old backup or a copied deployment does not suggest they ever mattered. Do not re-add
  them. The same goes for `BLE_SECRET`, below.
- `CSP_REPORT_ONLY=1` downgrades the Content-Security-Policy to report-only. Useful for
  a few hours after a client change, to see violations in the browser console without
  breaking anything — but **production must not run with it set**, and it once sat there
  long enough that the carefully written policy was being ignored entirely. Unset it and
  restart to enforce; confirm with
  `curl -sI http://127.0.0.1:5000/api/healthz | grep -i content-security-policy`, which
  must print `Content-Security-Policy:` and not `-Report-Only`.
- `CSP_EXTRA_CONNECT_SRC` is an **optional** comma-separated list appended to the CSP
  `connect-src` allow-list in [server/src/config/security.js](server/src/config/security.js).
  The policy is otherwise `'self'` only, so a public page that has to reach a third-party
  origin needs that origin added here rather than the directive being loosened in code.
  Production does not currently set it. Everything else in the policy — `script-src`,
  `frame-ancestors`, `form-action` and the rest — is fixed in `security.js` and has no
  environment override on purpose.
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

`.github/workflows/deploy.yml` runs a **`test` job first**, and the deploy job does not
start unless it passes (`needs: test`). That job takes its own checkout, installs with
`--include=dev` (jest and the web build toolchain live in devDependencies, and the deploy
itself installs `--omit=dev`, so the suite cannot run there), type-checks and builds the
web client, and then runs the server tests with `MONGO_TEST_URI=off` so nothing touches
production Mongo. Previously nothing was tested before a release reached the server.

`MONGO_TEST_URI=off` matters because the runner **is** the production host, and the
address `jest.globalSetup.js` probes when the variable is unset — `127.0.0.1:27017` — is
the live database itself, not a decoy that merely shares its name. The live-DB suites drop
the database they are pointed at. `off` is the only value meaning "do not probe"; unset
*and* empty both mean "go looking". For local work, point `MONGO_TEST_URI` at a scratch
database — the Atlas `uop_attendance_test` is what this project uses, and each live suite
suffixes it with its own name so they never drop one another's data.

**The web build comes before the suite on purpose.** Two tests in
`webApp.routes.test.js` gate themselves on `web/dist/index.html` existing — the PWA
manifest / iOS home-screen icon check and the asset cache-header check — and `web/dist`
is gitignored, so a fresh checkout never has it. With the build ordered last those two
skipped on every CI run since the gate was added: not failing, silently absent, and a
skipped test looks exactly like a passing one in Jest's summary line. Ordering the build
first costs nothing, since the same build already ran in that job, and it fails a broken
client before the server suite spends time.

The test step also pins **`NODE_ENV: test`** rather than relying on Jest's default, which
only applies when the variable is unset. This runner *is* the production host, so it may
already carry `NODE_ENV=production`, and both ways that can land break the run without
saying why:

| Ambient state | What happens |
| --- | --- |
| `NODE_ENV=production`, no `SESSION_SECRET` | `config/env.js` calls `process.exit(1)` while being required. 14 suites report `Jest worker encountered 4 child process exceptions` — nothing about the real cause |
| `NODE_ENV=production` + `SESSION_SECRET` | `middlewares/testAuth.js` switches its test-only auth bypass off; 130 tests fail on 401s |
| `NODE_ENV=test` | 486 pass, 88 skipped (the three live-DB suites, by `MONGO_TEST_URI=off`) |

Either failure blocks every deploy behind a red job that reads like a code regression and
is not one. `NODE_ENV` is set on the **step**, not the job, so the web build below it is
left alone — Vite decides its own mode.

Verified by simulating the job against a clean `git clone`: `npm ci --include=dev` for both
workspaces, `tsc -b && vite build` producing `dist/index.html`, and the suite passing with
exit code 0 under the job's exact environment. Reverting one line of the schedule-window
fix in that clone produced exit code 1, confirming the gate actually blocks a deploy rather
than only appearing to. What remains unverified is the runner itself: `actions/checkout@v4`
and the `/usr/bin/npm` paths cannot be exercised off the host, so the first real run still
needs watching.

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
