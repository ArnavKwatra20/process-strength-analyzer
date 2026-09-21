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

/** Host-wide metrics that are not available through the Node.js `os` module. */
export interface HostMetrics {
  /** Percentage of the primary system drive that is currently in use (0-100), or null when unavailable. */
  diskUsed: number | null;
  /** Network receive throughput in bytes per second across all adapters, or null when a rate is not yet measurable. */
  networkRx: number | null;
  /** Network send throughput in bytes per second across all adapters, or null when a rate is not yet measurable. */
  networkTx: number | null;
}

/** Read-only description of the analysis boundaries and collection capabilities of this server. */
export interface ServiceMeta {
  version: string;
  platform: string;
  source: string;
  readOnly: true;
  thresholds: {
    /** Process CPU percentage that triggers a review observation. */
    cpuPercent: number;
    /** Process working set size in bytes that triggers a review observation. */
    memoryBytes: number;
    /** Child process count that triggers a review observation. */
    children: number;
  };
  capabilities: {
    diskUsage: boolean;
    networkRates: boolean;
    processOwner: boolean;
    networkConnections: boolean;
  };
}

export interface AnalysisObservation {
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  reason: string;
  observed: string;
  threshold: string;
  recommendation: string;
}
