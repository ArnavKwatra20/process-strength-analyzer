# Process Strength Analyzer

Process Strength Analyzer (PSA) is a local, **read-only** developer diagnostics workstation for understanding observable system behavior. It inspects running processes, parent/child relationships, host-wide resource usage, local TCP/UDP connections where available, and transparent heuristic observations.

> **Important:** this is **not an antivirus** and heuristic observations are **not malware verdicts**. Scores and observations only describe how current readings compare against documented review thresholds.

**Live deployment:** `https://client-ruddy-psi.vercel.app` (frontend on Vercel; live data flows through an authenticated tunnel to the Windows API — see [Remote deployment](#remote-deployment-vercel--cloudflare-tunnel)).

## Table of contents

- [Features](#features)
- [Architecture and repository layout](#architecture-and-repository-layout)
- [How data is collected](#how-data-is-collected)
- [Heuristic analysis model](#heuristic-analysis-model)
- [API reference](#api-reference)
- [Security model](#security-model)
- [Environment variables](#environment-variables)
- [Setup — run locally](#setup--run-locally)
- [Scripts and quality gates](#scripts-and-quality-gates)
- [Remote deployment (Vercel + Cloudflare Tunnel)](#remote-deployment-vercel--cloudflare-tunnel)
- [Troubleshooting](#troubleshooting)
- [Data, limitations, and platform support](#data-limitations-and-platform-support)
- [Tech stack](#tech-stack)

## Features

- Overview dashboard with CPU / memory / disk / network charts (Recharts) and an in-memory session history (last 60 samples).
- Process explorer with search, running/network filters, sorting, and a detail view showing owner, path, command line, start time, threads, and direct children.
- Process tree view derived from PID → PPID links.
- Network view of TCP/UDP endpoints (`netstat -ano` on Windows) with owning process names resolved from the shared process listing.
- Transparent per-process heuristic analysis: `NORMAL` / `REVIEW` / `ELEVATED` level, 0–100 score, and a list of observations each carrying observed value, threshold, reason, and recommendation.
- Session events feed with pause/resume and monitoring toggle; polling interval adjustable (1s / 2s / 5s).
- Settings view driven by `/api/meta`: shows server version, platform, data source, review thresholds, and per-feature capabilities (disk usage, network rates, process owner, connection ownership).
- Server-driven UI: the sidebar version, Settings thresholds, and capability labels are rendered from `/api/meta`, so the interface never hardcodes a server value.

## Architecture and repository layout

```
process analyzer/
├── client/                  # React + TypeScript + Vite UI
│   ├── api/[...path].ts     # Vercel serverless relay: forwards /api/* to API_BACKEND_URL + bearer token
│   ├── src/
│   │   ├── api.ts           # Typed fetch client (VITE_API_URL aware, 15s timeout)
│   │   ├── App.tsx          # All views: overview, processes, tree, network, analysis, events, settings
│   │   └── main.tsx / index.css
│   ├── index.html
│   ├── vite.config.ts       # Dev server on :5173 with /api proxy injecting API_AUTH_TOKEN server-side
│   └── vercel.json          # Rewrites /api/:path* -> /api/[...path] so nested routes work on Vercel
├── server/                  # Express + TypeScript read-only API
│   └── src/
│       ├── server.ts            # Security headers, CORS allowlist, rate limit, auth, routes, error mapping
│       ├── processService.ts    # Win32_Process + PerfProc listing, 500ms shared cache, GetOwner lookup
│       ├── hostMetricsService.ts# Win32_LogicalDisk + Win32_PerfRawData_Tcpip_NetworkInterface rates
│       ├── systemService.ts     # Node os.* + host metrics + history ring buffer (60)
│       ├── networkService.ts    # netstat -ano parsing + PID->name resolution
│       ├── analysisService.ts   # Single source of truth for review thresholds + scoring
│       ├── metaService.ts       # Builds /api/meta from package version + thresholds + platform
│       └── types.ts             # Shared ProcessRecord / SystemSnapshot / NetworkConnection / ServiceMeta
├── package.json             # Root scripts: dev (concurrently), lint, check, build, preview
├── .env.example             # PORT, API_AUTH_TOKEN, ALLOWED_ORIGINS, API_BACKEND_URL (relay only)
└── .gitignore               # node_modules, dist, .env (secrets never committed)
```

- `client/`: React + TypeScript + Vite interface with Recharts charts and Lucide icons.
- `server/`: Express + TypeScript API. Windows collection uses fixed PowerShell/WMI and `netstat.exe` queries; non-Windows systems use a portable `ps` fallback where available.
- No database or elevated permissions are required. Session history exists in memory only (`history` ring buffer, last 60 snapshots).

## How data is collected

Windows is the primary supported platform. All collectors are fixed, read-only queries — the server never accepts arbitrary shell commands.

| Signal | Windows source | Non-Windows fallback |
|---|---|---|
| Process list (pid, ppid, name, path, command line, CPU, working set, threads, creation time) | `Win32_Process` joined with `Win32_PerfFormattedData_PerfProc_Process` (`PercentProcessorTime / ProcessorCount`), one PowerShell pass shared via a 500 ms cache | `ps -eo pid,ppid,comm,rss,nlwp,etime` (no CPU/path/command-line) |
| Process owner | Per-process `Win32_Process.GetOwner`, only for the selected PID | `Unavailable` |
| Disk usage (`diskUsed`, % of system drive) | `Win32_LogicalDisk` (`DriveType=3`, current `SystemDrive`) | `null` |
| Network throughput (`networkRx`/`networkTx`, B/s) | Cumulative `Win32_PerfRawData_Tcpip_NetworkInterface` counters divided by elapsed time between two `/api/system` samples | `null` |
| Network connections | `netstat.exe -ano` parsed into protocol/local/remote/state/pid, PID → name resolved from the shared listing | `[]` |
| Host CPU / memory | `node:os.cpus()` delta between samples; `totalmem()`/`freemem()` | Same |

First-sample behavior: `networkRx`/`networkTx` are `null` on the very first sample (no previous counters yet). Samples under 200 ms apart reuse the last known rate. Counter resets are clamped to `>= 0`. Start times are ISO 8601 UTC. Some fields may read `Unavailable` due to OS permissions or exited processes.

## Heuristic analysis model

`server/src/analysisService.ts` is the single source of truth for review boundaries. The client renders whatever `/api/meta` returns — it never hardcodes them.

| Threshold | Default | Triggers |
|---|---|---|
| `cpuPercent` | `75` | HIGH “High CPU usage” when `cpu > 75` |
| `memoryBytes` | `1073741824` (1 GiB) | MEDIUM “High memory usage” when working set exceeds 1 GiB |
| `children` | `8` | LOW “Many child processes” when direct children `>= 8` |
| Executable location (fixed rule) | `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)` | LOW “Unusual executable location” otherwise |

Scoring: start at 100, subtract 35 per HIGH, 20 per MEDIUM, 8 per LOW (floored at 0). `>= 85` → `NORMAL`, `60–84` → `REVIEW`, `< 60` → `ELEVATED`. Each observation carries `severity`, `title`, `reason`, `observed`, `threshold`, and `recommendation`. Workload triage only — not a malware verdict.

## API reference

Base URL locally: `http://localhost:4000`. In production the browser calls the same-origin Vercel relay (`https://client-ruddy-psi.vercel.app/api/...`), which forwards to the tunnel and injects the bearer token server-side.

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None (public) | Liveness probe → `{"status":"ok"}` |
| `GET` | `/api/meta` | Bearer | Server version (from `server/package.json`), platform, data source, thresholds, capabilities |
| `GET` | `/api/system` | Bearer | Snapshot: timestamp, cpu %, memory used/total (bytes), `diskUsed` %, `networkRx`/`networkTx` (B/s or null), process count, source |
| `GET` | `/api/system/history` | Bearer | Last up-to-60 snapshots (in-memory ring buffer) |
| `GET` | `/api/processes` | Bearer | Full process list (`ProcessRecord[]`) |
| `GET` | `/api/processes/:pid` | Bearer | One process plus resolved `owner` (`DOMAIN\User` or null); `400` for invalid PID, `404` when exited |
| `GET` | `/api/processes/:pid/children` | Bearer | Direct children (`ppid === pid`); `400` for invalid PID |
| `GET` | `/api/analysis/:pid` | Bearer | `{level, score, observations}` for one PID; `400`/`404` as above |
| `GET` | `/api/network` | Bearer | TCP/UDP connections with owning process names |

Error shape: `{ "message": "..." }` with `400` (invalid PID), `401` (missing/invalid bearer), `404` (unknown route or exited PID), `429` (rate limit), `503` (`Remote API is not configured` from the Vercel relay when env is missing), `500` (unexpected). All responses carry `Cache-Control: no-store`.

## Security model

- **Read-only by design.** Only predefined `GET` routes exist. No shell input, no remote execution, no persistence, no credential access, no injection, no kill/terminate actions.
- **Bearer auth on everything except `/health`.** The token lives only in `.env` files and server-side env vars — never in a `VITE_` variable, never in browser JavaScript.
- **CORS allowlist.** Only origins in `ALLOWED_ORIGINS` (default `http://localhost:5173`) receive `Access-Control-Allow-Origin`, and only for `GET` + `Authorization`.
- **Rate limiting.** 600 requests per 60-second sliding window per client IP on `/api/*`. The fastest UI cadence (four routes per second at the 1 s interval) stays inside the ceiling; a shared tunnel counts as one client by socket address.
- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, plus `no-store` caching.
- **Secrets hygiene.** Root `.env` and `server/.env` are gitignored and never committed. Rotate the token if it leaks; redeploy Vercel after rotation.

## Environment variables

Documented in `.env.example`. Never commit real values.

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `PORT` | root `.env` / `server/.env` | No (default `4000`) | Port the Express API listens on |
| `API_AUTH_TOKEN` | root `.env` (+ Vercel Production) | **Yes** | Bearer token for every `/api/*` route; Vite proxy and Vercel relay inject it server-side |
| `ALLOWED_ORIGINS` | root `.env` | No (default `http://localhost:5173`) | Comma-separated CORS allowlist, e.g. `http://localhost:5173,https://client-ruddy-psi.vercel.app` |
| `API_BACKEND_URL` | Vercel Production only | For hosted UI | HTTPS URL of the tunnel in front of the Windows API |
| `VITE_API_URL` | client local only | No (default same-origin `/api`) | Only for pointing a local UI at a separately hosted API; **leave unset on Vercel** |

The API resolves the root `.env` by path rather than by working directory, so `npm run dev` from the repo root and `npm --prefix server run dev` both read it. An optional `server/.env` is loaded first and wins for any variable it defines.

## Setup — run locally

Requires Node.js 20+.

```bash
npm install
npm --prefix client install
npm --prefix server install
```

Create a root `.env` (gitignored — never commit it):

```env
PORT=4000
API_AUTH_TOKEN=replace-with-a-long-random-secret
ALLOWED_ORIGINS=http://localhost:5173,https://client-ruddy-psi.vercel.app
```

Generate a 48-byte token with PowerShell:

```powershell
$bytes = [byte[]]::new(48)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
Start everything (API + UI concurrently) from the repo root:

```bash
npm run dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:4000`.

The local client uses Vite's `/api` proxy by default. The proxy reads `API_AUTH_TOKEN` from the root `.env` and injects it server-side. For a hosted client, the Vercel `/api/*` function forwards requests to `API_BACKEND_URL` and injects `API_AUTH_TOKEN` server-side.

Verify local authentication:

```powershell
Invoke-WebRequest http://localhost:4000/health
Invoke-WebRequest http://localhost:4000/api/processes -SkipHttpErrorCheck   # expect 401
$headers = @{ Authorization = "Bearer $env:API_AUTH_TOKEN" }
Invoke-WebRequest http://localhost:4000/api/processes -Headers $headers      # expect 200
```

## Scripts and quality gates

| Command | Where | What it does |
|---|---|---|
| `npm run dev` | root | Runs API (`tsx watch server/src/server.ts`) + Vite UI concurrently |
| `npm run lint` | root / client / server | ESLint (`--max-warnings=0` at root) |
| `npm run check` | root / client / server | TypeScript project references (`tsc -b`) |
| `npm run build` | root / client / server | `tsc -b && vite build` (client) / `tsc -p tsconfig.build.json` (server) |
| `npm run preview` | root / client | Serves the production `dist/` build (client default `:4173`) |

Run before every commit/push:

```bash
npm run lint
npm run check
npm run build
```

## Remote deployment (Vercel + Cloudflare Tunnel)

Vercel cannot reach `localhost:4000` on your Windows machine. The Windows backend must keep running locally, and the deployed frontend needs an authenticated HTTPS tunnel to reach it.

Request path in production: browser → `https://client-ruddy-psi.vercel.app/api/*` → Vercel serverless relay (`client/api/[...path].ts`, rewritten via `client/vercel.json`) → `API_BACKEND_URL` (tunnel) → `http://localhost:4000` on your PC. The relay adds `Authorization: Bearer <API_AUTH_TOKEN>` without exposing it to browser JavaScript.

### 1. Run the backend

```powershell
npm --prefix server run dev
```

### 2. Expose it through an authenticated HTTPS tunnel

**Permanent setup (recommended):** use a named Cloudflare Tunnel with a domain you control.

After installing `cloudflared` on Windows, authenticate and create the tunnel:

```powershell
cloudflared tunnel login
cloudflared tunnel create psa-windows-api
cloudflared tunnel route dns psa-windows-api api.your-domain.example
```

Create `%USERPROFILE%\.cloudflared\config.yml` using the tunnel UUID and credentials path printed by `tunnel create`:

```yaml
tunnel: YOUR-TUNNEL-UUID
credentials-file: C:\Users\YOUR-WINDOWS-USER\.cloudflared\YOUR-TUNNEL-UUID.json

ingress:
	- hostname: api.your-domain.example
		service: http://localhost:4000
	- service: http_status:404
```

Run the named tunnel as a foreground process while the diagnostics backend is running:

```powershell
cloudflared tunnel run psa-windows-api
```

Use `https://api.your-domain.example` as `API_BACKEND_URL`.

**Temporary setup (testing only):** `cloudflared tunnel --url http://localhost:4000` prints a `https://<random>.trycloudflare.com` URL. It works, but it changes on every restart — update `API_BACKEND_URL` in Vercel and redeploy each time. Never treat it as permanent.

The tunnel supplies HTTPS transport, while `API_AUTH_TOKEN` protects every diagnostics request. Keep the token enabled and do not share the hostname unnecessarily. For stronger access control, add Cloudflare Access in front; the bearer token remains mandatory.

### 3. Vercel environment variables

Deploy from `client/` (build command `tsc -b && vite build`, output `dist`):

```powershell
cd client
npx --yes vercel@latest deploy --prod --yes
```

In the Vercel project settings, add these Production variables. Keep them server-only; do not prefix them with `VITE_`:

```text
API_BACKEND_URL=https://api.your-domain.example
API_AUTH_TOKEN=the-exact-same-token-as-the-local-backend
```

Redeploy after saving the variables. Leave `VITE_API_URL` unset or empty in Vercel: the production browser calls the same-origin `/api/*` relay. Do not point `VITE_API_URL` directly at the Windows tunnel, because the browser would not have the server-only bearer token.

If cloudflared restarts with a new Quick Tunnel URL, rotate it with the CLI and redeploy:

```powershell
'y' | npx --yes vercel@latest env rm API_BACKEND_URL production
$newUrl | npx --yes vercel@latest env add API_BACKEND_URL production
npx --yes vercel@latest deploy --prod --yes
```

### 4. Remote testing

1. Start the Windows backend with the configured `.env`.
2. Start the HTTPS tunnel and copy its URL into Vercel as `API_BACKEND_URL`.
3. Set the same token in the backend and Vercel as `API_AUTH_TOKEN`.
4. Confirm `https://your-tunnel.example.com/health` returns only `{ "status": "ok" }`.
5. Open the Vercel URL and verify the process list and system metrics load.
6. If the UI reports an unavailable API, inspect the Vercel function logs and confirm the tunnel is running; never disable authentication to troubleshoot.

Expected live results: `/` → 200 HTML; `/api/meta` → thresholds + capabilities; `/api/system` → cpu/disk/network/processCount; `/api/processes` → live list; `/api/processes/4` → System process; `/api/analysis/4` → `{level, score, observations}`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| UI shows “local API unavailable” locally | API not running or token mismatch | Start `npm run dev`; confirm root `.env` has `API_AUTH_TOKEN`; check `http://localhost:4000/health` |
| `401` on `/api/*` | Missing/wrong bearer token | Send `Authorization: Bearer <API_AUTH_TOKEN>`; confirm the Vite proxy / Vercel relay has the same token |
| `429` on `/api/*` | Over 600 req/min from one IP | Slow the polling interval (Settings → 2s/5s); a shared tunnel counts as one client |
| `503 Remote API is not configured` on Vercel | `API_BACKEND_URL`/`API_AUTH_TOKEN` missing in Vercel Production | Add both as Production vars (server-only) and redeploy |
| Vercel UI loads but no data | Tunnel stopped or URL rotated | Restart cloudflared, update `API_BACKEND_URL`, redeploy |
| `/api/processes/NNN` → 404 | Process exited between list and detail | Re-select from a fresh list |
| `/api/*` → 404 (Vercel only, nested paths) | Missing rewrite | Confirm `client/vercel.json` has the `/api/:path* → /api/[...path]` rewrite |
| `networkRx`/`networkTx` null | First sample, or sub-200 ms resample | Poll again after the next interval; verify `Win32_PerfRawData_Tcpip_NetworkInterface` is available |
| UI lists `Unavailable` fields | OS permissions or exited processes | Run as the same user that owns the processes; some system processes never expose paths/owners |
| Port already in use (`:4000`/`:5173`) | Stale dev/tunnel process | Stop the old `node`/`cloudflared` process, then restart |

## Data, limitations, and platform support

- Reads observable system information only. Fields may be `Unavailable` due to OS permissions or process-lifetime races.
- Windows is the primary supported platform. Non-Windows gets the `ps` process fallback; disk, network rates, owners, and connections stay `Unavailable`/`[]`.
- Process owners use per-process `GetOwner` only for the selected PID (doing it for every process per poll would be too slow), so the list reports `user` as `Unavailable`.
- Session history is in-memory only (last 60 snapshots); restarting the API clears it.
- `trycloudflare.com` Quick Tunnel URLs are ephemeral — they change on restart. A named tunnel + your own domain is the permanent option.
- Not an antivirus; heuristic observations are not malware verdicts.

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript, Vite 6, Recharts, Lucide icons |
| API | Express 5, TypeScript, `tsx` (dev), `helmet`-style headers, `cors`, `express-rate-limit`, `dotenv` |
| Collection (Windows) | PowerShell CIM (`Win32_Process`, `Win32_PerfFormattedData_PerfProc_Process`, `Win32_LogicalDisk`, `Win32_PerfRawData_Tcpip_NetworkInterface`), `netstat.exe -ano` |
| Hosting | Vercel (static UI + `api/[...path].ts` serverless relay), Cloudflare Tunnel (HTTPS to local Windows API) |
| Quality | ESLint, `tsc -b` project references |
