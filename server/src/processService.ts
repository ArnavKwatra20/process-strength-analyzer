import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessRecord } from './types.js';

const execFileAsync = promisify(execFile);

const powershellScript = `
$cpuByPid = @{}
$processorCount = [Environment]::ProcessorCount
try {
  Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop | ForEach-Object {
    $cpuByPid[[int]$_.IDProcess] = [math]::Round(([double]$_.PercentProcessorTime / $processorCount), 1)
  }
} catch {}
$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $processId = [int]$_.ProcessId
  [PSCustomObject]@{
    pid = $processId
    ppid = if ($_.ParentProcessId) { [int]$_.ParentProcessId } else { $null }
    name = [string]$_.Name
    path = $_.ExecutablePath
    commandLine = $_.CommandLine
    user = $null
    status = 'running'
    cpu = if ($cpuByPid.ContainsKey($processId)) { $cpuByPid[$processId] } else { $null }
    memory = if ($_.WorkingSetSize) { [int64]$_.WorkingSetSize } else { $null }
    threads = if ($_.ThreadCount) { [int]$_.ThreadCount } else { $null }
    startedAt = if ($_.CreationDate) { ([datetime]$_.CreationDate).ToUniversalTime().ToString('o') } else { $null }
  }
}
$processes | ConvertTo-Json -Compress
`;

function parseJson<T>(value: string): T {
  const parsed: unknown = JSON.parse(value);
  return parsed as T;
}

export async function listProcesses(): Promise<ProcessRecord[]> {
  if (process.platform !== 'win32') {
    return listPortableProcesses();
  }
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershellScript], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const raw = parseJson<Record<string, unknown> | Array<Record<string, unknown>>>(stdout.trim() || '[]');
    const items = Array.isArray(raw) ? raw : [raw];
    return items.map(normalizeProcess);
  } catch {
    return [];
  }
}

function normalizeProcess(value: Record<string, unknown>): ProcessRecord {
  return {
    pid: Number(value.pid), ppid: value.ppid == null ? null : Number(value.ppid), name: String(value.name ?? 'Unknown'),
    path: typeof value.path === 'string' ? value.path : null, commandLine: typeof value.commandLine === 'string' ? value.commandLine : null,
    user: typeof value.user === 'string' ? value.user : null, status: value.status === 'running' ? 'running' : 'unknown',
    cpu: typeof value.cpu === 'number' ? value.cpu : null, memory: typeof value.memory === 'number' ? value.memory : null,
    threads: typeof value.threads === 'number' ? value.threads : null, startedAt: typeof value.startedAt === 'string' ? value.startedAt : null
  };
}

// Polling routes refresh together, so one short-lived cache keeps a single PowerShell pass shared
// between them without serving a list that is meaningfully older than the polling interval.
const cacheTtlMs = 500;
let cachedProcesses: ProcessRecord[] | null = null;
let cachedAt = 0;
let inFlight: Promise<ProcessRecord[]> | null = null;

/** Cached listing for routes that poll together. Callers that need a fresh snapshot use `listProcesses`. */
export async function listProcessesCached(): Promise<ProcessRecord[]> {
  if (cachedProcesses && Date.now() - cachedAt < cacheTtlMs) return cachedProcesses;
  if (inFlight) return inFlight;
  const pending = listProcesses().then((processes) => { cachedProcesses = processes; cachedAt = Date.now(); return processes; });
  inFlight = pending;
  try { return await pending; } finally { if (inFlight === pending) inFlight = null; }
}

/**
 * Resolves the owning account for a single process. `Win32_Process` does not carry an owner, so this
 * is an explicit per-process lookup and is only used for the detail view rather than the full list.
 */
export async function resolveProcessOwner(pid: number): Promise<string | null> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid < 0) return null;
  const script = `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue
if ($process) {
  $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction SilentlyContinue
  if ($owner -and $owner.User) { if ($owner.Domain) { [string]::Concat($owner.Domain, '\\', $owner.User) } else { [string]$owner.User } }
}`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const owner = stdout.trim();
    return owner || null;
  } catch { return null; }
}

async function listPortableProcesses(): Promise<ProcessRecord[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,comm=,rss=,nlwp=,etime='], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/);
      return { pid: Number(parts[0]), ppid: Number(parts[1]) || null, name: parts[2] ?? 'Unknown', path: null, commandLine: null, user: null, status: 'running', cpu: null, memory: Number(parts[3]) * 1024 || null, threads: Number(parts[4]) || null, startedAt: null };
    });
  } catch { return []; }
}

export function getProcess(pid: number, processes: ProcessRecord[]): ProcessRecord | undefined { return processes.find((process) => process.pid === pid); }
export function buildChildren(pid: number, processes: ProcessRecord[]): ProcessRecord[] { return processes.filter((process) => process.ppid === pid); }
