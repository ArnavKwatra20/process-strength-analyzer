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
