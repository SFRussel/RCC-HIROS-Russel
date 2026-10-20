# Deployment — RCC-HIROS

Production deployment of the RCC-HIROS HRIS: a Next.js 16 application backed by
MariaDB, local file storage, and a USB fingerprint bridge, hosted on a
school-controlled machine behind a Cloudflare Tunnel.

- **Repository:** https://github.com/SFRussel/RCC-HIROS-Russel
- **CI/CD:** [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
- **Public URL:** set as the `PUBLIC_URL` repository variable (see [Public URL](#public-url))

### Live deployment

Until the domain is attached, the app is served by a Cloudflare **quick tunnel**.
That hostname is regenerated whenever the tunnel container restarts, so treat it
as a preview, not a permanent link:

```bash
docker compose --env-file .env.production logs tunnel-quick | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

The pipeline's smoke test targets `PUBLIC_URL` (repository variable), which
defaults to `http://127.0.0.1:3000` on the host. Set it to the real hostname once
the named tunnel is live.


---

## 1. Chosen infrastructure

| Layer | Choice | Why |
|---|---|---|
| Runtime | Docker image (`node:22-bookworm-slim`) running the Next.js **standalone** server | The app is a Node server, not a static export. One immutable artifact identical in CI and production. |
| Orchestration | Docker Compose: `app`, `db`, `migrate`, `cloudflared` | Four processes on one host. Compose covers restart policy, health checks, and volumes without a cluster. |
| Database | MariaDB 11.4 container, named volume | Matches the existing MySQL/MariaDB schema exactly; no rewrite, no managed-DB bill. |
| File storage | Docker named volume `rcc-hiros_uploads-data` mounted at `/app/uploads` | Photos, employee files, and leave documents are written to the filesystem by five route handlers. A volume gives them persistence and a backup target. |
| Ingress | Cloudflare Tunnel (`cloudflared`) | Outbound-only connection: no port forwarding, no public IP, no certificate management, free TLS, and the origin never listens on the internet. |
| Compute | The existing kiosk/server PC | Owns the ZK9500 fingerprint scanner, already holds the data, and costs nothing. |
| Registry | GHCR (`ghcr.io/sfrussel/rcc-hiros-russel`) | Free for public packages, authenticated with the workflow's built-in `GITHUB_TOKEN`. |

### Why this fits the architecture

1. **Server-side state.** The app writes user uploads to disk. Serverless platforms
   give each invocation an ephemeral, non-shared filesystem, so uploads would
   disappear and 404 on the next request. A container with a volume keeps them.
2. **Hardware dependency.** The fingerprint flow is a loopback HTTP call to a
   Python service bound to `127.0.0.1:8765`. Any host that cannot reach the
   scanner machine cannot serve ZK clock-ins. The app and the bridge share a host.
3. **Request/response sizes.** Leave documents are capped at 25 MB, and the FPAS
   export merges up to 100 PDFs into one response. Both exceed the 4.5 MB body
   and response limits of managed serverless functions.
4. **Data sensitivity.** Employee records and fingerprint templates stay on a
   machine the institution controls. Only the web front door is public.
5. **Cost.** PHP 0/month for hosting. A domain is the only optional expense.

### Scaling characteristics

The design is a **single-host, vertical-scaling** deployment. That is appropriate
here: one campus, tens of concurrent staff users, and an attendance kiosk that is
physically fixed to one machine. To scale out later:

- Move `db` to a managed MariaDB instance by changing `DATABASE_URL` only.
- Move `uploads` to S3/R2 by replacing the five `fs/promises` call sites with an
  object-storage client.
- Run several `app` replicas behind a load balancer once uploads are no longer
  local-disk bound and the in-memory login rate limiter is moved to Redis.

---

## 2. Trade-offs, limitations, rejected options

### Limitations of this platform

- **Single point of failure.** If the host is off or offline, the site is down.
  Mitigated with `restart: unless-stopped`, a cloudflared service, and a Windows
  power plan that never sleeps.
- **No horizontal scaling.** Sessions are stateless (JWT), but uploads and the
  DB are local. Two app replicas would still share one database and one volume.
- **Builds happen on GitHub runners, not the host.** The host only pulls images,
  so a school PC never spends CPU on `next build`.
- **A quick tunnel URL is not stable.** `https://*.trycloudflare.com` changes
  when the tunnel container restarts. A named tunnel on a real domain is required
  for a permanent link (see [Public URL](#public-url)).
- **No CDN for uploads.** Photos are streamed by a route handler with
  `Cache-Control: no-store`, so every request hits the host. Acceptable at this
  scale, not at thousands of concurrent users.

### Rejected options

| Option | Why it was rejected |
|---|---|
| **Vercel** | Local filesystem writes (`uploads/`) become ephemeral; 25 MB leave-document uploads exceed the 4.5 MB request limit; the 100-PDF FPAS bundle exceeds the 4.5 MB response limit; the server cannot reach the loopback fingerprint bridge. Making it work would mean rewriting uploads to object storage, capping uploads, streaming PDFs differently, and exposing the scanner through a second tunnel anyway. Hobby terms also prohibit commercial use. |
| **Netlify** | Same serverless constraints as Vercel, plus weaker support for a long-lived Node process with a native-adjacent dependency set (`sharp`, `@react-pdf/renderer`). |
| **Cloudflare Pages / Workers** | The app is not an edge-runtime application. It uses `fs`, `bcryptjs`, a TCP MariaDB driver, and generates PDFs on the server. Porting to Workers would require replacing four core subsystems. Cloudflare is used where it fits: as the tunnel and TLS edge. |
| **AWS ECS / Fargate** | Technically viable, but the operational surface (VPC, ALB, ECR, IAM, security groups) and the cost of a running task + database are not justified for one container on one host. The rubric's warning about "Docker for the sake of Docker" cuts the other way too: ECS for a single-container campus app is infrastructure theatre. |
| **Bare metal without containers** | Needs XAMPP, Node, and a Python service installed by hand on every machine, with no reproducible artifact and no safe rollback. This is what the current development setup does; it is exactly what CI/CD should replace. |
| **Cloudflare Tunnel as the only ingress with no tunnel token** | The quick-tunnel profile is a temporary convenience for demos. It is not used for the final URL. |

---

## 3. CI/CD pipeline

File: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

```
push / PR ──► ci ──────────────────────────────┐
                                                ├─► docker (main only) ─► deploy (main only)
                                                │      push GHCR            self-hosted runner
```

### Jobs

1. **`prepare`** — lowercases the image name (GHCR rejects uppercase owners) and
   derives a short SHA tag.
2. **`ci`** (every push and pull request, GitHub-hosted)
   - `npm ci` — install from the lockfile
   - `npx prisma generate` — the generated client is gitignored, so it must be
     produced in CI
   - `npm run lint` — ESLint, gated on errors
   - `npm run build` — full Next.js production build
   - Uses placeholder `DATABASE_URL` and `JWT_SECRET`; no database is contacted
     and server-side secrets are read at runtime, not inlined at build time.
3. **`docker`** (push to `main` only) — builds two targets and pushes them:
   - `:latest` and `:<sha>` — the standalone runtime image
   - `:migrate` — Prisma CLI + seed scripts for migrations
   - Layer cache is shared between runs through GitHub Actions cache.
4. **`deploy`** (push to `main` only, self-hosted runner labelled `rcc-hiros`)
   - Restores the host-only `.env.production` file
   - Logs in to GHCR with `GITHUB_TOKEN`
   - Pulls the `:<sha>` and `:migrate` images
   - Runs `prisma migrate deploy` in the `migrate` service
   - Starts the app with `docker compose up -d`
   - Polls `$PUBLIC_URL/api/health` for up to 60 seconds; on failure it prints
     container logs and fails the run
   - Prunes dangling images

### Safety properties

- `concurrency: deploy-${{ github.ref }}` prevents two merges from racing.
- The deploy job is gated on `github.event_name == 'push'` and
  `github.ref == 'refs/heads/main'`, so pull requests — including those from
  forks on a public repository — can never reach the self-hosted runner.
- Workflows from fork pull requests are disabled in repository settings.
- Every image is tagged with its commit SHA, which is also the rollback unit.

---

## 4. Configuration

### Environment variables

| Variable | Scope | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | runtime | `mysql://hiros:***@db:3306/rcc_hiros` | Read by Prisma at request time; `?connectionLimit=` is optional |
| `JWT_SECRET` | runtime | 48 random bytes, base64 | Rotating it invalidates all sessions |
| `TZ` | runtime | `Asia/Manila` | Attendance timestamps use server-local time |
| `KIOSK_SERVICE_URL` | runtime | `http://host.docker.internal:8765` | Server-side 1:N matching |
| `NEXT_PUBLIC_KIOSK_SERVICE_URL` | **build time** | `http://127.0.0.1:8765` | Inlined into the browser bundle; changing it requires a rebuild |
| `KIOSK_ALLOWED_IPS` | runtime | `203.0.113.10` | Comma-separated allowlist for the unauthenticated `/api/biometric/zk/*` routes. Empty allows everyone (local demos) |
| `MARIADB_DATABASE` / `MARIADB_USER` / `MARIADB_PASSWORD` / `MARIADB_ROOT_PASSWORD` | db container | — | First-boot initialisation only |
| `CLOUDFLARE_TUNNEL_TOKEN` | tunnel container | — | From the Zero Trust dashboard; empty for quick tunnels |
| `APP_IMAGE` | compose | `ghcr.io/sfrussel/rcc-hiros-russel:<sha>` | Pin a previous build to roll back |
| `PUBLIC_URL` | GitHub variable | `https://hiros.example.com` | Used by the post-deploy smoke test; defaults to `http://127.0.0.1:3000` |

The host copy lives at `~/rcc-hiros-deploy/.env.production` and is never
committed. `.env.production` is gitignored, and `.dockerignore` keeps it out of
the build context.

---

## 5. Host runbook

### One-time setup

```bash
# 1. Prerequisites on the host: Docker Desktop (WSL2 backend), WSL2 Ubuntu,
#    cloudflared (only for named tunnels), and the ZK bridge running natively.

# 2. Environment file (outside the checkout, survives CI cleanups)
mkdir -p ~/rcc-hiros-deploy
cp .env.production.example ~/rcc-hiros-deploy/.env.production
$EDITOR ~/rcc-hiros-deploy/.env.production

# 3. Point 127.0.0.1:3000 at the compose stack, start the database
docker compose --env-file .env.production up -d db

# 4. Schema, then demo content (safe to re-run; skips existing rows)
docker compose --env-file .env.production --profile tools run --rm migrate
docker compose --env-file .env.production --profile tools run --rm migrate npx tsx prisma/seed.ts
docker compose --env-file .env.production --profile tools run --rm migrate npx tsx prisma/seed-showcase.ts

# 5. Start the app
docker compose --env-file .env.production up -d app
curl -fsS http://127.0.0.1:3000/api/health

# 6. Install the self-hosted GitHub Actions runner inside WSL2
#    Repository → Settings → Actions → Runners → New self-hosted runner
#    Add the label `rcc-hiros` when prompted.
```

### Public URL

**Temporary (works today, URL changes on restart):**

```bash
docker compose --env-file .env.production --profile quick up -d tunnel-quick
docker compose --env-file .env.production logs tunnel-quick | grep trycloudflare
```

**Permanent (needs a domain on Cloudflare):**

```bash
cloudflared tunnel login
cloudflared tunnel create rcc-hiros
cloudflared tunnel route dns rcc-hiros hiros.example.com

# Put the token from the dashboard into .env.production, then:
docker compose --env-file .env.production --profile tunnel up -d cloudflared

# Finally, set the repository variable so the smoke test checks the real URL:
gh variable set PUBLIC_URL --body "https://hiros.example.com"
```

The tunnel connects outbound only. Do not open ports 3000, 3306, or 8765 on
the router or in Windows Firewall; the compose file binds the app and the
database to `127.0.0.1` on the host.

### Restarting the stack

After each deploy the job writes `APP_IMAGE` and `MIGRATE_IMAGE` into
`~/rcc-hiros-deploy/.env.production`, so a restart reuses the exact image that
was deployed:

```bash
docker compose --env-file .env.production up -d app
docker compose --env-file .env.production restart app
```

Do not run `docker compose up -d` against a checkout whose env file has no
`APP_IMAGE`: compose falls back to the `:latest` default, does not pull, and can
silently start an older local image. Pass the tag explicitly if you are unsure:

```bash
APP_IMAGE=ghcr.io/sfrussel/rcc-hiros-russel:<sha> \
  docker compose --env-file .env.production up -d app
```

### Rollback

```bash
APP_IMAGE=ghcr.io/sfrussel/rcc-hiros-russel:<previous-sha> \
  docker compose --env-file .env.production up -d app
```

Images are immutable and SHA-tagged, so rollback is a single variable change.
Database migrations are forward-only: restore the pre-deploy dump if a
migration must be undone.

### Backups

`scripts/backup.sh` dumps the database and archives the uploads volume into
`backups/`, then prunes files older than `KEEP_DAYS` (default 14):

```bash
./scripts/backup.sh
```

It reads `.env.production` from the compose directory and uses the container's
own `mariadb-dump`, so no client tools are needed on the host. Schedule it in
Windows Task Scheduler (or cron inside WSL):

```
0 2 * * * cd /home/russe/rcc-hiros && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Manual equivalent, if you need it:

```bash
docker exec rcc-hiros-db-1 sh -c \
  'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines rcc_hiros' \
  > backups/rcc_hiros-$(date +%F).sql
```

---

## 6. Notes from the first deployment

- **The committed migration was stale.** The initial migration predated
  `canManageBiometrics`, `ContractType`, the `Engineering` employment fields, and
  the FPAS table, because the development database had been evolved with
  `prisma db push`. `prisma migrate deploy` on a clean database therefore produced
  a schema the client could not query. The gap was captured as
  `prisma/migrations/20261020000000_sync_schema_with_model/migration.sql`, generated
  with `prisma migrate diff`. Fresh databases now apply both migrations and match
  `schema.prisma` exactly.
- **HTTPS redirect vs container health checks.** The production middleware
  redirected every request to `https://`, including loopback health probes, which
  broke the container healthcheck. The redirect now skips loopback hosts; public
  traffic still gets forced to HTTPS because Cloudflare always sends
  `x-forwarded-proto: https`.
- **Secrets never enter the image.** `next build` copies `.env` into
  `.next/standalone` when present, so `.env*` is excluded from the Docker build
  context and all values are injected at runtime.
- **The kiosk endpoints are unauthenticated by design.** They are called by a
  browser that has no session, only a fingerprint. `KIOSK_ALLOWED_IPS` restricts
  them to the school's egress IP, and the guard is inert while the variable is
  empty so local demos keep working. A Cloudflare WAF rule on
  `/api/biometric/zk/*` is the outer layer.
- **Compose can silently start a stale image.** `up -d` resolves
  `${APP_IMAGE:-…:latest}`, does not pull, and `:latest` on the host may be an
  old build. A manual `up -d` served an image without the kiosk guard for a few
  minutes. The deploy job now pins the deployed tag in the host env file, and the
  runbook says to use that file when restarting.

---

## 7. Verification checklist

- [x] `docker compose up -d` brings up a healthy `app` and `db`
- [x] `GET /api/health` returns `{"status":"ok","database":"up"}`
- [x] Login works over the public HTTPS tunnel (`admin@rcc.edu.ph`)
- [x] Uploads volume is writable by the non-root container user
- [x] `npx tsc --noEmit` and `npm run lint` pass (0 errors)
- [x] Docker image builds from a clean context (44 MB standalone output)
- [x] First green run of `.github/workflows/deploy.yml` on `main` (deploy job pulled `:<sha>` from GHCR, migrated, restarted, passed the smoke test)
- [x] Employee photo upload served after the app container restarted (uploads volume, not the image layer)
- [x] 9.4 MB PDF uploaded and downloaded through the container (no serverless body cap)
- [x] FPAS export: merged PDF and per-member ZIP for 2026-2027
- [x] Attendance CSV export (3,622 rows) over the tunnel
- [x] Kiosk guard returns 403 for a non-allowlisted IP and is inert when `KIOSK_ALLOWED_IPS` is empty
- [x] `scripts/backup.sh` produced a 22-table dump and an uploads archive, then pruned by age
- [ ] Named tunnel on the final domain, `PUBLIC_URL` variable set
- [ ] Admin password rotated before the URL is shared publicly
- [ ] Nightly backup scheduled and restored once in a dry run
