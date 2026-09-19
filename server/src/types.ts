export type ProcessStatus = 'running' | 'stopped' | 'unknown';

export interface ProcessRecord {
  pid: number;
  ppid: number | null;
  name: string;
  path: string | null;
  commandLine: string | null;
  user: string | null;
  status: ProcessStatus;
  cpu: number | null;
  memory: number | null;
  threads: number | null;
  startedAt: string | null;
}

export interface SystemSnapshot {
  timestamp: string;
  cpu: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  diskUsed: number | null;
  networkRx: number | null;
  networkTx: number | null;
  processCount: number;
  source: string;
}

export interface NetworkConnection {
  pid: number;
  process: string;
  protocol: string;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
}

export interface AnalysisObservation {
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  reason: string;
  observed: string;
  threshold: string;
  recommendation: string;
}
