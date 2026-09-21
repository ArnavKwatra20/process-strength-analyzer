import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listProcessesCached } from './processService.js';
import type { NetworkConnection } from './types.js';
const execFileAsync = promisify(execFile);

type RawConnection = Omit<NetworkConnection, 'process'>;

export async function listNetwork(): Promise<NetworkConnection[]> {
  if (process.platform !== 'win32') return [];
  // netstat only reports owning PIDs, so the process names are resolved from the shared listing.
  const [connections, processes] = await Promise.all([readConnections(), listProcessesCached()]);
  const namesByPid = new Map(processes.map((item) => [item.pid, item.name]));
  return connections.map((connection) => ({ ...connection, process: namesByPid.get(connection.pid) ?? 'Unavailable' }));
}

async function readConnections(): Promise<RawConnection[]> {
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter((line) => /^\s*(TCP|UDP)/i.test(line)).map((line) => { const parts = line.trim().split(/\s+/); const isTcp = parts[0].toUpperCase() === 'TCP'; const local = splitAddress(parts[1]); const remote = splitAddress(parts[2]); return { pid: Number(parts[isTcp ? 4 : 3]), protocol: parts[0], localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port, state: isTcp ? parts[3] : 'LISTENING' }; }).filter((item) => Number.isFinite(item.pid));
  } catch { return []; }
}

function splitAddress(value: string): { address: string; port: number } { const index = value.lastIndexOf(':'); return { address: index > 0 ? value.slice(0, index) : value, port: Number(value.slice(index + 1)) || 0 }; }
