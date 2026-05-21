# UOP Attendance Management System — Server Environment & Setup

This file documents the actual production environment of the UoP Attendance Management System hosted at **https://attendance.eng.pdn.ac.lk**, and the exact steps that were taken to bring it up from a blank Ubuntu VM. It is a *living* runbook: edit it whenever any of the facts below change.

- **Server hostname (OS):** `attendance-vm`
- **Public hostname:** `attendance.eng.pdn.ac.lk`
- **Repository (deploys from):** https://github.com/udayaKavinda/uop-attendance-management-system
- **Last verified:** 2026-05-14
- **Scope note:** API behavior details (attendance flow, session overlap rules, lecturer reassignment behavior) are maintained in the root `README.md`.

---

## 1. Host

| Property | Value |
|---|---|
| Distribution | Ubuntu 24.04.4 LTS (`noble`), x86_64 |
| Kernel | `6.8.0-111-generic` |
| Hypervisor | KVM (QEMU) |
| Virtual CPU model | `Intel(R) Xeon(R) Gold 5218R CPU @ 2.10GHz` (host‑passthrough; AVX/AVX2/AVX‑512 visible to the guest) |
| Internal IP | `10.40.2.171/24` |
| Admin user | `attendance-admin` (uid 1000) — owns the app, runs Node, runs the GitHub Actions runner |
| Sudo policy | `attendance-admin ALL=(ALL) NOPASSWD: ALL` via `/etc/sudoers.d/99-attendance-admin` |
| Firewall (ufw) | `OpenSSH`, `Nginx Full` allowed; default deny incoming |
| Timezone | `Asia/Colombo` (forced via `TZ` in app `.env`) |

### Why the CPU model matters

MongoDB 5.0+ (and therefore the 8.0 line shipped here) executes AVX instructions during startup. An earlier attempt to run MongoDB 8 on this VM failed with `Illegal instruction (core dumped)` because the VM had been booted with the default QEMU vCPU model (`QEMU Virtual CPU version 2.5+`), which advertises only SSE4.2 + AES — no AVX. The fix was applied on the hypervisor (CPU type switched to `host-passthrough`), the VM was fully power‑cycled, and the guest now sees the real Xeon Gold 5218R with `avx avx2 avx512*` flags. **Any future VM migration or hypervisor change must preserve AVX visibility, or MongoDB will SIGILL on next start.**

---

## 2. DNS

`attendance.eng.pdn.ac.lk` is **split‑horizon** (different IPs depending on where you query from):

| Resolver | Resolves to | Used for |
|---|---|---|
| Campus DNS (this VM's `/etc/resolv.conf`) | `10.40.2.171` (this VM) | direct in‑network access |
| Public DNS (`8.8.8.8`, `1.1.1.1`) | `192.248.40.154` | off‑campus access; ACME HTTP‑01 challenge from Let's Encrypt |

The public IP `192.248.40.154` is operated by university IT and forwards inbound TCP/80 + TCP/443 to this VM at `10.40.2.171:80` / `:443`. This NAT forward is what makes Let's Encrypt HTTP‑01 validation succeed for what is, internally, a private‑IP host.

---

## 3. Topology

```
┌────────────────────────────────────────────────────────────────────────────┐
│ public internet                                                            │
│                                                                            │
│   off-campus browser                          on-campus browser            │
│        │                                          │                        │
│        ▼                                          ▼                        │
│   192.248.40.154 (UoP IT NAT)                10.40.2.171  (direct)         │
│        │                                          │                        │
│        └──────────────────┬───────────────────────┘                        │
│                           ▼                                                │
│                    attendance-vm  (10.40.2.171)                            │
│                    ┌─────────────────────────────────────┐                 │
│                    │ Nginx 1.24    :80 / :443            │                 │
│                    │   ├─ /.well-known/acme-challenge -> /var/www/letsencrypt
│                    │   ├─ /api/*  -> 127.0.0.1:5000     │                 │
│                    │   ├─ /auth/* -> 127.0.0.1:5000     │                 │
│                    │   └─ /*      -> /opt/attendance/app/build (static)   │
│                    └────────────┬────────────────────────┘                 │
│                                 ▼                                          │
│                    Node API (attendance.service)                           │
│                          127.0.0.1:5000                                    │
│                                 │                                          │
│                                 ▼                                          │
│                    MongoDB 8 (mongod.service)                              │
│                          127.0.0.1:27017                                   │
│                                                                            │
│                    GitHub Actions runner (attendance-prod)                 │
│                    actions.runner.<repo>.attendance-prod.service           │
│                          long-poll outbound to github.com                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Software inventory

| Component | Version | Source |
|---|---|---|
| Ubuntu | 24.04.4 LTS | base image |
| Node.js | 20.20.2 (system, `/usr/bin/node`) | NodeSource APT repo |
| npm | 10.8.2 | bundled with Node.js 20.20.2 |
| MongoDB Community | 8.0.23 | mongodb‑org APT repo |
| `mongosh` | 2.8.3 | mongodb‑org APT repo |
| Nginx | 1.24.0 (Ubuntu) | Ubuntu archive |
| certbot | 2.9.0 | Ubuntu archive |
| GitHub Actions runner | 2.334.0 | github.com/actions/runner release |

The repository's frontend toolchain (React 19, react‑scripts 5, Leaflet, etc.) is installed into `/opt/attendance/app/node_modules` via `npm install` and is not tracked here.

---

## 5. Directory layout

```
/opt/attendance/
├── app/                     # checked-out repo; current production code
│   ├── .env                 # secrets (mode 600, owned by attendance-admin)
│   ├── .github/workflows/
│   │   └── deploy.yml       # self-hosted deploy pipeline
│   ├── build/               # static React build served by Nginx
│   ├── node_modules/
│   ├── package.json
│   ├── public/
│   ├── server/
│   │   ├── index.js
│   │   ├── lib/
│   │   └── models/
│   └── src/
├── releases/                # empty placeholder for future blue/green deploys
└── runner/                  # GitHub Actions runner files
    ├── _work/               # transient job workspaces (created by jobs)
    ├── bin/
    ├── config.sh
    ├── run.sh
    └── svc.sh

/var/log/attendance/
├── app.log                  # Node stdout (server boot, request logs if enabled)
└── app.err.log              # Node stderr

/var/www/letsencrypt/
└── .well-known/acme-challenge/   # webroot for HTTP-01 renewals (Nginx serves this)

/etc/letsencrypt/
├── live/attendance.eng.pdn.ac.lk/   # cert symlinks (fullchain.pem, privkey.pem)
├── archive/attendance.eng.pdn.ac.lk/ # historical certs
├── renewal/attendance.eng.pdn.ac.lk.conf
└── renewal-hooks/deploy/reload-nginx.sh   # post-renew nginx reload

/etc/nginx/sites-available/attendance.eng.pdn.ac.lk.conf  # site config
/etc/nginx/sites-enabled/attendance.eng.pdn.ac.lk.conf    # symlink

/etc/systemd/system/
├── attendance.service                                            # Node app
└── actions.runner.udayaKavinda-uop-attendance-management-system.attendance-prod.service

/usr/local/sbin/
├── acme-auth-hook.sh        # (legacy, from DNS-01 attempt; safe to keep)
└── acme-cleanup-hook.sh     # (legacy, from DNS-01 attempt; safe to keep)
```

---

## 6. Environment variables (`/opt/attendance/app/.env`)

Loaded by systemd's `EnvironmentFile=` directive into the `attendance.service` process. **File mode is `600`, owned by `attendance-admin:attendance-admin`. Never commit this file.**

| Key | Production value | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | enables `Secure; SameSite=None` cookies, enforces CSP, fails fast if `SESSION_SECRET` missing |
| `PORT` | `5000` | Express listen port (loopback only) |
| `TZ` | `Asia/Colombo` | server timezone for schedule comparisons |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/attendance` | DB + connect‑mongo session store |
| `APP_BASE_URL` | `https://attendance.eng.pdn.ac.lk` | OAuth callback base |
| `FRONTEND_URL` | `https://attendance.eng.pdn.ac.lk` | CORS allow‑list + post‑OAuth redirect |
| `REACT_APP_API_BASE` | *(empty)* | SPA fetches API on same origin (Nginx proxies) |
| `SESSION_SECRET` | *random hex (64 bytes)* | HMAC secret for `express-session` cookies |
| `GOOGLE_CLIENT_ID` | the OAuth client ID | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | the OAuth secret | Google OAuth |
| `CSP_REPORT_ONLY` | `1` (currently report‑only) | flip to `0` once no CSP violations are reported in DevTools |

To rotate the session secret (forces all current users to re-login):
```bash
openssl rand -hex 64
# paste the output into the SESSION_SECRET line in /opt/attendance/app/.env
sudo systemctl restart attendance
```

---

## 7. Services (`systemctl`)

| Service unit | What it runs | User | Autostart |
|---|---|---|---|
| `mongod.service` | `/usr/bin/mongod --config /etc/mongod.conf` | `mongodb` | yes |
| `attendance.service` | `/usr/bin/node server/index.js` | `attendance-admin` | yes |
| `nginx.service` | nginx master process | `root` (workers as `www-data`) | yes |
| `certbot.timer` | runs `certbot renew` twice daily | `root` | yes |
| `actions.runner.udayaKavinda-uop-attendance-management-system.attendance-prod.service` | GitHub Actions runner listener | `attendance-admin` | yes |

### `attendance.service` (full contents)

```ini
[Unit]
Description=UOP Attendance Management System (Express API + static SPA)
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
User=attendance-admin
Group=attendance-admin
WorkingDirectory=/opt/attendance/app
EnvironmentFile=/opt/attendance/app/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/attendance/app.log
StandardError=append:/var/log/attendance/app.err.log

NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

After editing, `sudo systemctl daemon-reload && sudo systemctl restart attendance`.

---

## 8. Nginx

Site config: `/etc/nginx/sites-available/attendance.eng.pdn.ac.lk.conf` → symlinked into `sites-enabled/`. The default Ubuntu site is disabled.

Highlights:

- `:80` listener
  - serves `/.well-known/acme-challenge/` from `/var/www/letsencrypt` (kept for cert renewals)
  - redirects everything else with `301 https://$host$request_uri`
- `:443` listener
  - TLS 1.2 + TLS 1.3, Mozilla intermediate ciphersuites, HTTP/2
  - HSTS: `max-age=15552000` (6 months)
  - `proxy_pass http://attendance_app` for `/api/` and `/auth/`
  - `root /opt/attendance/app/build;` for everything else, with SPA fallback `try_files $uri /index.html;`
  - long‑lived caching for `/static/` (`max-age=2592000, public, immutable`)
  - sets `X-Forwarded-For`, `X-Forwarded-Proto`, etc.; the Express app calls `app.set('trust proxy', 1)` so client IP is real

Restart / reload:
```bash
sudo nginx -t              # validate
sudo systemctl reload nginx
```

---

## 9. TLS — Let's Encrypt (HTTP‑01)

| Item | Value |
|---|---|
| Cert path | `/etc/letsencrypt/live/attendance.eng.pdn.ac.lk/fullchain.pem` (+ `privkey.pem`) |
| Issuer | Let's Encrypt **E7** |
| Currently valid until | **2026‑08‑12** |
| Validation method | `webroot` HTTP‑01 (path: `/var/www/letsencrypt`) |
| Auto‑renewal | `certbot.timer` → `certbot renew` twice daily; on success, `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` reloads Nginx |
| ACME account email | `e19155@eng.pdn.ac.lk` |

Manual test:
```bash
sudo certbot renew --dry-run
```

If renewal ever fails, the most likely cause is the UoP IT NAT no longer forwarding TCP/80 from `192.248.40.154`. Quick check:
```bash
curl -I http://attendance.eng.pdn.ac.lk/.well-known/acme-challenge/_probe
```
should return `404` (the directory exists but the file does not) — anything other than that signals nginx or NAT trouble.

---

## 10. CI/CD — self‑hosted GitHub Actions runner

| Item | Value |
|---|---|
| Runner name | `attendance-prod` |
| Labels | `self-hosted,linux,x64,attendance-prod` |
| Bound to repo | `https://github.com/udayaKavinda/uop-attendance-management-system` |
| Install path | `/opt/attendance/runner` |
| Work dir | `/opt/attendance/runner/_work` |
| Runs as | `attendance-admin` |
| Systemd unit | `actions.runner.udayaKavinda-uop-attendance-management-system.attendance-prod.service` |
| Runner version | 2.334.0 |

### Deploy workflow (`.github/workflows/deploy.yml`)

Triggers on every `push` to `main` and on manual `workflow_dispatch`. The workflow:

1. `cd /opt/attendance/app`
2. `git fetch && git reset --hard origin/main && git clean -fdx -e .env -e build -e node_modules`
3. `node --check server/index.js`
4. `npm install --no-audit --no-fund`
5. `REACT_APP_API_BASE="" CI=false npm run build`
6. `sudo systemctl restart attendance`
7. healthcheck against `http://127.0.0.1:5000/api/healthz`

End‑to‑end deploy time observed: ~30–60 seconds.

### Manual triggers

- **Push:** any commit on `main` triggers it automatically.
- **GitHub UI:** Actions → "Deploy to attendance.eng.pdn.ac.lk" → "Run workflow".
- **From this server (no GitHub):** simulate locally:
  ```bash
  cd /opt/attendance/app
  git fetch && git reset --hard origin/main
  PATH=/usr/bin:$PATH npm install --no-audit --no-fund
  PATH=/usr/bin:$PATH REACT_APP_API_BASE="" CI=false npm run build
  sudo systemctl restart attendance
  curl -fsS http://127.0.0.1:5000/api/healthz
  ```

### Rotating the runner registration token

The registration token used during initial setup was single‑use and is gone. To re‑register (e.g. after wiping `/opt/attendance/runner`):

```bash
sudo /opt/attendance/runner/svc.sh stop
sudo /opt/attendance/runner/svc.sh uninstall
sudo -u attendance-admin /opt/attendance/runner/config.sh remove --token <REMOVE_TOKEN>
# … then re-run config.sh with a fresh registration token from
# Settings → Actions → Runners → New self-hosted runner
sudo /opt/attendance/runner/svc.sh install attendance-admin
sudo /opt/attendance/runner/svc.sh start
```

### Updating the runner version

Runner auto-update is enabled by default; GitHub upgrades it in place. To force a manual upgrade:

```bash
sudo /opt/attendance/runner/svc.sh stop
cd /opt/attendance/runner
sudo -u attendance-admin curl -L -o actions-runner.tar.gz https://github.com/actions/runner/releases/download/v<NEW>/actions-runner-linux-x64-<NEW>.tar.gz
sudo -u attendance-admin tar xzf actions-runner.tar.gz
sudo -u attendance-admin rm actions-runner.tar.gz
sudo /opt/attendance/runner/svc.sh start
```

---

## 11. MongoDB

- Bound to `127.0.0.1:27017` only (loopback). No auth required because no remote network exposure.
- Data dir: `/var/lib/mongodb` (default).
- Logs: `/var/log/mongodb/mongod.log`.
- Database used by the app: `attendance` (auto‑created on first connect).
- Sessions collection (`connect-mongo`) lives in the same DB; TTL 7 days.

Quick ops:
```bash
# Connect:
mongosh attendance

# List collections after the app has been used:
mongosh attendance --eval 'db.getCollectionNames()'

# Promote a user to admin (after they have signed in once via Google):
mongosh attendance --eval '
  db.people.updateOne(
    { email: "user@eng.pdn.ac.lk" },
    { $set: { role: "admin" } }
  )'
```

### Backups

Manual:
```bash
sudo mkdir -p /var/backups/attendance
sudo mongodump --db attendance --archive=/var/backups/attendance/$(date +%F).gz --gzip
```

For scheduled backups, add a cron entry under `attendance-admin` (or root), keep ≥7 daily archives, and ship them off‑host. **Always take a backup before any Mongo or app major upgrade** — the app runs collection‑rename migrations on first start.

---

## 12. Google OAuth

| Item | Value |
|---|---|
| OAuth client (Google Cloud Console) | created under the project that hosts this app |
| Authorized JavaScript origin | `https://attendance.eng.pdn.ac.lk` |
| Authorized redirect URI | `https://attendance.eng.pdn.ac.lk/auth/google/callback` |
| Where the creds live on the server | `/opt/attendance/app/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) |

After changing OAuth values, `sudo systemctl restart attendance`.

A user signing in for the first time is created in MongoDB with `role: "student"`. Lecturer/admin roles must be set manually (or via the admin dashboard once the first admin exists).

---

## 13. Logs & observability

| What | Where |
|---|---|
| Node stdout (server boot, etc.) | `/var/log/attendance/app.log` |
| Node stderr (uncaught errors) | `/var/log/attendance/app.err.log` |
| Nginx access | `/var/log/nginx/access.log` |
| Nginx error | `/var/log/nginx/error.log` |
| MongoDB | `/var/log/mongodb/mongod.log` |
| Let's Encrypt | `/var/log/letsencrypt/letsencrypt.log` |
| Systemd journal (any of the units) | `sudo journalctl -u <unit-name> -f` |

Useful one‑liners:
```bash
# tail everything app-related:
sudo journalctl -u attendance -u nginx -u mongod -f

# 50 last lines of the API:
tail -n 50 /var/log/attendance/app.log

# request rate over the last 5 minutes (rough):
awk -v t="$(date -d '5 minutes ago' +'%d/%b/%Y:%H:%M')" '$4 >= "["t' /var/log/nginx/access.log | wc -l
```

---

## 14. Operational tasks

### Restart the API

```bash
sudo systemctl restart attendance
```

### Reload Nginx (no downtime)

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Re‑deploy without pushing to GitHub

See **§10 → Manual triggers → From this server**.

### Roll back a bad deploy

```bash
cd /opt/attendance/app
git log --oneline -n 10              # pick a known-good SHA
git reset --hard <SHA>
PATH=/usr/bin:$PATH npm install --no-audit --no-fund
PATH=/usr/bin:$PATH REACT_APP_API_BASE="" CI=false npm run build
sudo systemctl restart attendance
```

The next `git push` to `main` will re‑deploy and overwrite this rollback. Use a revert commit on GitHub to make a rollback permanent.

### Switch CSP from report‑only to enforce

After ≥1 full day of normal use with no `[CSP]` violations in browser DevTools (Reports tab):
```bash
sudo sed -i 's/^CSP_REPORT_ONLY=1/CSP_REPORT_ONLY=0/' /opt/attendance/app/.env
sudo systemctl restart attendance
```

### Renew TLS now (instead of waiting for the timer)

```bash
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

### Add a new server-side env variable

1. Add `KEY=value` to `/opt/attendance/app/.env`.
2. `sudo systemctl restart attendance`.

### Add a new CRA build-time variable

Anything prefixed `REACT_APP_` is read by the build, not the running Node process. To make it available to the SPA you must rebuild:
1. Add `REACT_APP_FOO=bar` to `.env` (and probably commit a matching line to the workflow so deploys export it).
2. Trigger a redeploy (push or `workflow_dispatch`).

---

## 15. Security notes

- `attendance-admin` currently has unrestricted NOPASSWD sudo. This is convenient for setup and for the GitHub Actions runner. If you want to tighten things later, replace `/etc/sudoers.d/99-attendance-admin` with a scoped rule:
  ```
  attendance-admin ALL=(root) NOPASSWD: /bin/systemctl restart attendance, /bin/systemctl reload nginx, /bin/systemctl status attendance
  ```
- `.env` is `chmod 600`, owned by `attendance-admin:attendance-admin`. Don't `chmod 644` it for convenience.
- The Google OAuth secret was once shared in chat during setup; **rotate it** in Google Cloud Console and re‑paste the new value into `.env`.
- Helmet + production CSP, per‑user rate limiting, and Mongo unique index on attendance (`student`, `session`, `attendanceDate`) are configured by the app itself; do not strip them.
- The runner runs arbitrary code from the repo it's attached to. Only trusted maintainers should be able to push to `main`. Consider protecting `main` with required reviews in repo settings.

---

## 16. Reproducing this environment from scratch

This is roughly the order the production setup was performed and is the order to follow if you ever need to rebuild on a fresh Ubuntu 24.04 VM.

**Prereqs:** The VM has been booted with a CPU model that exposes AVX/AVX2 (see §1). DNS `attendance.eng.pdn.ac.lk` is in place on both campus and public resolvers. The UoP NAT forwards public TCP/80 + TCP/443 to this VM. You are logged in as `attendance-admin` with sudo.

```bash
# 1. Base packages
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg lsb-release ufw git build-essential
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable

# 2. Node.js 20 LTS (system-wide)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs

# 3. MongoDB 8
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt update && sudo apt -y install mongodb-org
sudo systemctl enable --now mongod
mongosh --eval 'db.runCommand({ping:1})'        # must print { ok: 1 }

# 4. Directory layout (owned by attendance-admin)
sudo mkdir -p /opt/attendance/app /opt/attendance/releases /opt/attendance/runner /var/log/attendance
sudo chown -R attendance-admin:attendance-admin /opt/attendance /var/log/attendance

# 5. Clone the app
cd /opt/attendance/app
git clone https://github.com/udayaKavinda/uop-attendance-management-system.git .

# 6. .env (replace placeholders!)
umask 077
cat > /opt/attendance/app/.env <<EOF
NODE_ENV=production
PORT=5000
TZ=Asia/Colombo
MONGO_URI=mongodb://127.0.0.1:27017/attendance
APP_BASE_URL=https://attendance.eng.pdn.ac.lk
FRONTEND_URL=https://attendance.eng.pdn.ac.lk
REACT_APP_API_BASE=
SESSION_SECRET=$(openssl rand -hex 64)
GOOGLE_CLIENT_ID=REPLACE_ME
GOOGLE_CLIENT_SECRET=REPLACE_ME
CSP_REPORT_ONLY=1
EOF
chmod 600 /opt/attendance/app/.env

# 7. Install Node deps + build SPA
cd /opt/attendance/app
PATH=/usr/bin:$PATH npm install --no-audit --no-fund
PATH=/usr/bin:$PATH REACT_APP_API_BASE="" CI=false npm run build

# 8. attendance.service (paste from §7 of this file), then:
sudo systemctl daemon-reload
sudo systemctl enable --now attendance
curl -fsS http://127.0.0.1:5000/api/healthz                 # {"status":"ok"}

# 9. Nginx site config (HTTP first; paste from §8 of this file), then:
sudo apt -y install nginx
sudo ln -sf /etc/nginx/sites-available/attendance.eng.pdn.ac.lk.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 10. ACME webroot + Let's Encrypt cert
sudo apt -y install certbot
sudo mkdir -p /var/www/letsencrypt/.well-known/acme-challenge
sudo chown -R www-data:www-data /var/www/letsencrypt
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --agree-tos --email e19155@eng.pdn.ac.lk --no-eff-email \
  --non-interactive -d attendance.eng.pdn.ac.lk

# 11. Add the HTTPS server block in nginx (paste full TLS config from §8), reload nginx
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run                                # must succeed
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'SH'
#!/bin/bash
systemctl reload nginx
SH
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# 12. Self-hosted GitHub Actions runner
cd /opt/attendance/runner
LATEST=$(curl -sS https://api.github.com/repos/actions/runner/releases/latest | grep -oP '"tag_name"\s*:\s*"\K[^"]+')
VER=${LATEST#v}
curl -fsSL -o actions-runner.tar.gz "https://github.com/actions/runner/releases/download/${LATEST}/actions-runner-linux-x64-${VER}.tar.gz"
tar xzf actions-runner.tar.gz && rm actions-runner.tar.gz
sudo /opt/attendance/runner/bin/installdependencies.sh
# fetch a fresh registration token from
#   https://github.com/udayaKavinda/uop-attendance-management-system/settings/actions/runners/new
./config.sh --url https://github.com/udayaKavinda/uop-attendance-management-system \
            --token <REG_TOKEN> --name attendance-prod \
            --labels self-hosted,linux,x64,attendance-prod \
            --work _work --unattended --replace
sudo ./svc.sh install attendance-admin
sudo ./svc.sh start

# 13. Commit .github/workflows/deploy.yml (text reproduced in §10) to the repo on main.
#     The runner picks it up automatically.
```

---

## 17. Glossary of files added/modified during setup

| Path | Created by setup? | Notes |
|---|---|---|
| `/etc/sudoers.d/99-attendance-admin` | yes | NOPASSWD sudo |
| `/opt/attendance/...` | yes | app + runner |
| `/var/log/attendance/` | yes | Node logs |
| `/var/www/letsencrypt/` | yes | ACME webroot |
| `/etc/systemd/system/attendance.service` | yes | Node app unit |
| `/etc/systemd/system/actions.runner.*.service` | yes (via runner installer) | runner unit |
| `/etc/nginx/sites-available/attendance.eng.pdn.ac.lk.conf` | yes | site config |
| `/etc/nginx/sites-enabled/attendance.eng.pdn.ac.lk.conf` | yes | symlink |
| `/etc/nginx/sites-enabled/default` | **removed** | replaced by our site |
| `/etc/letsencrypt/...` | yes (via certbot) | cert + renewal config |
| `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` | yes | post‑renew nginx reload |
| `/usr/local/sbin/acme-auth-hook.sh` | yes | (legacy DNS‑01 attempt; unused) |
| `/usr/local/sbin/acme-cleanup-hook.sh` | yes | (legacy DNS‑01 attempt; unused) |
| `/etc/apt/sources.list.d/mongodb-org-8.0.list` | yes | MongoDB repo |
| `/etc/apt/sources.list.d/nodesource.sources` | yes | Node.js repo |

---

## 18. Things deliberately *not* set up (yet)

These are reasonable next steps but were out of scope for the initial bring‑up.

- **Off‑host MongoDB backups.** `mongodump` cron + scp/rsync to an off‑VM target.
- **Logrotate** for `/var/log/attendance/app*.log`. The Node service appends forever; rotate to keep disk usage bounded.
- **External uptime monitoring** (UptimeRobot, BetterUptime, etc.) pointing at `https://attendance.eng.pdn.ac.lk/api/healthz`.
- **Fail2ban** on Nginx auth endpoints. The app does per-user rate limiting via `express-rate-limit`, so this is belt‑and‑braces.
- **Replica / failover.** Currently a single VM; if it dies the service is down until restored.
- **Scoped sudoers** for `attendance-admin` (see §15).
- **CDN.** Static assets are served directly from this VM; for higher load consider Cloudflare in front of `192.248.40.154` (though the IP is private‑NAT, so this would need IT coordination).