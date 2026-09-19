import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
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
    startedAt = if ($_.CreationDate) { [string]$_.CreationDate } else { $null }
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
export function formatMemory(bytes: number | null): string { if (bytes == null) return 'Unavailable'; const units = ['B', 'KB', 'MB', 'GB']; let value = bytes; let index = 0; while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; } return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`; }
export function systemMemory(): { total: number; free: number } { return { total: os.totalmem(), free: os.freemem() }; }
