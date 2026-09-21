export interface ProcessRecord { pid: number; ppid: number | null; name: string; path: string | null; commandLine: string | null; user: string | null; status: string; cpu: number | null; memory: number | null; threads: number | null; startedAt: string | null; }
export interface SystemSnapshot { timestamp: string; cpu: number | null; memoryUsed: number | null; memoryTotal: number | null; diskUsed: number | null; networkRx: number | null; networkTx: number | null; processCount: number; source: string; }
export interface Analysis { level: 'NORMAL' | 'REVIEW' | 'ELEVATED'; score: number; observations: { severity: string; title: string; reason: string; observed: string; threshold: string; recommendation: string }[]; }
export interface NetworkConnection { pid: number; process: string; protocol: string; localAddress: string; localPort: number; remoteAddress: string; remotePort: number; state: string; }
export interface ServiceMeta { version: string; platform: string; source: string; readOnly: boolean; thresholds: { cpuPercent: number; memoryBytes: number; children: number }; capabilities: { diskUsage: boolean; networkRates: boolean; processOwner: boolean; networkConnections: boolean }; }
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const requestTimeoutMs = 15_000;
const get = async <T,>(path: string): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(requestTimeoutMs) });
  } catch {
    throw new Error('The local API did not respond');
  }
  if (!response.ok) {
    const payload: { message?: unknown } | null = await response.json().catch(() => null);
    throw new Error(typeof payload?.message === 'string' ? payload.message : `The local API rejected the request (status ${response.status})`);
  }
  return response.json() as Promise<T>;
};
export const api = {
  meta: () => get<ServiceMeta>('/api/meta'),
  processes: () => get<ProcessRecord[]>('/api/processes'),
  process: (pid: number) => get<ProcessRecord>(`/api/processes/${pid}`),
  children: (pid: number) => get<ProcessRecord[]>(`/api/processes/${pid}/children`),
  system: () => get<SystemSnapshot>('/api/system'),
  history: () => get<SystemSnapshot[]>('/api/system/history'),
  network: () => get<NetworkConnection[]>('/api/network'),
  analysis: (pid: number) => get<Analysis>(`/api/analysis/${pid}`)
};
