# Process Strength Analyzer

Process Strength Analyzer (PSA) is a local, read-only developer diagnostics workstation for understanding observable system behavior. It inspects running processes, relationships, resource usage, local network connections where available, and transparent heuristic observations.

## Architecture

- `client/`: React + TypeScript + Vite interface with Recharts, Framer Motion-ready layout, and Lucide icons.
- `server/`: Express + TypeScript API. Windows collection uses fixed PowerShell/WMI and `netstat.exe` queries; non-Windows systems use a portable `ps` fallback where available.
- No database or elevated permissions are required. Session history exists in memory only.

## Setup

Requires Node.js 20+.

```bash
npm install
npm --prefix client install
npm --prefix server install
npm run dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:4000`.

The local client uses Vite's `/api` proxy by default. The proxy reads `API_AUTH_TOKEN` from the root `.env` file and injects it server-side. Never use a `VITE_` variable for the token. For a hosted client, the Vercel `/api/*` function forwards requests to `API_BACKEND_URL` and injects `API_AUTH_TOKEN` server-side. `VITE_API_URL` remains available when using a separately hosted API origin.

Production build:

```bash
npm run lint
npm run check
npm run build
npm run preview
```

## Data and limitations

The application reads observable system information only. Some fields, executable paths, command lines, users, and network ownership may be `Unavailable` because of operating-system permissions or process lifetime races. Windows is the primary supported platform. This is not an antivirus and heuristic observations are not malware verdicts.

The server exposes only predefined read-only routes. It does not accept arbitrary shell commands, remote execution, persistence, credential access, injection, or destructive process actions.

## API

`GET /api/system`, `/api/system/history`, `/api/processes`, `/api/processes/:pid`, `/api/processes/:pid/children`, `/api/analysis/:pid`, and `/api/network`.

Environment variables are documented in `.env.example`.

## Secure Remote Windows API

Vercel cannot access `localhost:4000` on a user's Windows machine. The Windows backend must keep running locally, and the deployed frontend needs a temporary or permanent authenticated HTTPS tunnel to reach it.

### Backend configuration

Create a root `.env` file locally. It is ignored by Git and must never be committed:

```env
PORT=4000
API_AUTH_TOKEN=replace-with-a-long-random-secret
ALLOWED_ORIGINS=http://localhost:5173,https://client-ruddy-psi.vercel.app
```

Generate a token with PowerShell:

```powershell
$bytes = [byte[]]::new(48)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$token = [Convert]::ToBase64String($bytes)
$token
```

The backend exposes only `GET /health` publicly, returning `{ "status": "ok" }`. Every `/api/*` diagnostics route requires `Authorization: Bearer <API_AUTH_TOKEN>`.

### Run the backend

```powershell
npm --prefix server run dev
```

Verify local authentication:

```powershell
Invoke-WebRequest http://localhost:4000/health
Invoke-WebRequest http://localhost:4000/api/processes -SkipHttpErrorCheck
$headers = @{ Authorization = "Bearer $env:API_AUTH_TOKEN" }
Invoke-WebRequest http://localhost:4000/api/processes -Headers $headers
```

### Expose it through an authenticated HTTPS tunnel

Cloudflare Tunnel is one option. Install `cloudflared`, then run:

```powershell
cloudflared tunnel --url http://localhost:4000
```

Use the generated HTTPS URL as `API_BACKEND_URL`. The tunnel URL is sensitive because it reaches the diagnostics API; keep `API_AUTH_TOKEN` enabled and do not share the URL unnecessarily. For a permanent deployment, use an authenticated Cloudflare Tunnel hostname and restrict access further with Cloudflare Access or an equivalent identity layer.

### Vercel environment variables

In the Vercel project settings, add these Production variables. Keep them server-only; do not prefix them with `VITE_`:

```text
API_BACKEND_URL=https://your-authenticated-tunnel.example.com
API_AUTH_TOKEN=the-exact-same-token-as-the-local-backend
```

Redeploy after saving the variables. The deployed frontend calls its same-origin `/api/*` relay, and the relay adds the bearer token without sending it to browser JavaScript.

### Remote testing

1. Start the Windows backend with the configured `.env`.
2. Start the HTTPS tunnel and copy its URL into Vercel as `API_BACKEND_URL`.
3. Set the same token in the backend and Vercel as `API_AUTH_TOKEN`.
4. Confirm `https://your-tunnel.example.com/health` returns only `{ "status": "ok" }`.
5. Open the Vercel URL and verify the process list and system metrics load.
6. If the UI reports an unavailable API, inspect the Vercel function logs and confirm the tunnel is running; never disable authentication to troubleshoot.

The remote connection is not considered operational until these steps succeed with a real tunnel and matching secrets. The hosted API exposes live Windows process, network, and system information, so use HTTPS, a long random token, an allowlisted origin, rate limiting, and an access-controlled tunnel.
