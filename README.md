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

Use a named Cloudflare Tunnel with a domain you control. Do not use `cloudflared tunnel --url`; that creates a Quick Tunnel and is not the required permanent/authenticated setup.

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

Use `https://api.your-domain.example` as `API_BACKEND_URL`. The named tunnel supplies HTTPS transport, while `API_AUTH_TOKEN` protects every diagnostics request. Keep the token enabled and do not share the hostname unnecessarily. For stronger access control, add Cloudflare Access and configure the relay with the required service-auth headers before enabling it; the bearer token remains mandatory.

### Vercel environment variables

In the Vercel project settings, add these Production variables. Keep them server-only; do not prefix them with `VITE_`:

```text
API_BACKEND_URL=https://your-authenticated-tunnel.example.com
API_AUTH_TOKEN=the-exact-same-token-as-the-local-backend
```

Redeploy after saving the variables. For this architecture, leave `VITE_API_URL` unset or empty in Vercel: the production browser calls the same-origin `/api/*` relay at `https://client-ruddy-psi.vercel.app/api/...`. Do not point `VITE_API_URL` directly at the Windows tunnel, because the browser would not have the server-only bearer token. The relay adds that token without sending it to browser JavaScript.

### Remote testing

1. Start the Windows backend with the configured `.env`.
2. Start the HTTPS tunnel and copy its URL into Vercel as `API_BACKEND_URL`.
3. Set the same token in the backend and Vercel as `API_AUTH_TOKEN`.
4. Confirm `https://your-tunnel.example.com/health` returns only `{ "status": "ok" }`.
5. Open the Vercel URL and verify the process list and system metrics load.
6. If the UI reports an unavailable API, inspect the Vercel function logs and confirm the tunnel is running; never disable authentication to troubleshoot.

The remote connection is not considered operational until these steps succeed with a real tunnel and matching secrets. The hosted API exposes live Windows process, network, and system information, so use HTTPS, a long random token, an allowlisted origin, rate limiting, and an access-controlled tunnel.
