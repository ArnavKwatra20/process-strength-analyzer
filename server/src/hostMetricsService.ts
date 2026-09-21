import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HostMetrics } from './types.js';

const execFileAsync = promisify(execFile);

// Fixed drives report disk usage; the raw TCP/IP interface counters expose cumulative byte totals.
// Cumulative totals are used instead of the formatted per-second classes so the server can compute
// an exact rate between two samples, matching how the system service derives CPU usage.
const windowsScript = `
$systemDrive = $env:SystemDrive
$drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue
$drive = if ($systemDrive) { $drives | Where-Object { $_.DeviceID -eq $systemDrive } | Select-Object -First 1 } else { $null }
if (-not $drive) { $drive = $drives | Select-Object -First 1 }
$counters = Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface -ErrorAction SilentlyContinue
[PSCustomObject]@{
  diskSize = if ($drive -and $drive.Size) { [int64]$drive.Size } else { $null }
  diskFree = if ($drive -and $drive.FreeSpace) { [int64]$drive.FreeSpace } else { $null }
  received = if ($counters) { [int64](($counters | Measure-Object -Property BytesReceivedPersec -Sum).Sum) } else { $null }
  sent = if ($counters) { [int64](($counters | Measure-Object -Property BytesSentPersec -Sum).Sum) } else { $null }
} | ConvertTo-Json -Compress
`;

interface RawHostCounters {
  diskSize: number | null;
  diskFree: number | null;
  received: number | null;
  sent: number | null;
}

// Two samples closer together than this cannot produce a meaningful rate.
const minimumSampleIntervalMs = 200;
let previousSample: { received: number; sent: number; at: number } | null = null;
let lastRates: { rx: number; tx: number } | null = null;

export async function readHostMetrics(): Promise<HostMetrics> {
  if (process.platform !== 'win32') return { diskUsed: null, networkRx: null, networkTx: null };
  const counters = await readWindowsCounters();
  if (!counters) return { diskUsed: null, networkRx: null, networkTx: null };
  const rates = calculateTransferRates(counters);
  return { diskUsed: calculateDiskUsage(counters), networkRx: rates.rx, networkTx: rates.tx };
}

async function readWindowsCounters(): Promise<RawHostCounters | null> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windowsScript], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const parsed: unknown = JSON.parse(stdout.trim() || 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    return { diskSize: toNumber(record.diskSize), diskFree: toNumber(record.diskFree), received: toNumber(record.received), sent: toNumber(record.sent) };
  } catch { return null; }
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateDiskUsage(counters: RawHostCounters): number | null {
  const { diskSize, diskFree } = counters;
  if (diskSize == null || diskFree == null || diskSize <= 0) return null;
  const used = Math.max(0, diskSize - diskFree);
  return Math.round((used / diskSize) * 1000) / 10;
}

function calculateTransferRates(counters: RawHostCounters): { rx: number | null; tx: number | null } {
  if (counters.received == null || counters.sent == null) return { rx: null, tx: null };
  const at = Date.now();
  if (!previousSample) { previousSample = { received: counters.received, sent: counters.sent, at }; return { rx: null, tx: null }; }
  const elapsedMs = at - previousSample.at;
  // Concurrent refreshes can sample twice in quick succession; reuse the previous rate instead of dividing by ~zero.
  if (elapsedMs < minimumSampleIntervalMs) return lastRates ? { rx: lastRates.rx, tx: lastRates.tx } : { rx: null, tx: null };
  const seconds = elapsedMs / 1000;
  // A counter reset (adapter restart) would otherwise produce a large negative delta.
  const rx = Math.round(Math.max(0, counters.received - previousSample.received) / seconds);
  const tx = Math.round(Math.max(0, counters.sent - previousSample.sent) / seconds);
  previousSample = { received: counters.received, sent: counters.sent, at };
  lastRates = { rx, tx };
  return lastRates;
}
