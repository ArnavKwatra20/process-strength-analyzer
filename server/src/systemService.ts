import os from 'node:os';
import { readHostMetrics } from './hostMetricsService.js';
import { listProcessesCached } from './processService.js';
import type { SystemSnapshot } from './types.js';

let previousCpu = os.cpus();
const history: SystemSnapshot[] = [];

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  const currentCpu = os.cpus();
  const cpu = calculateCpu(previousCpu, currentCpu);
  previousCpu = currentCpu;
  const total = os.totalmem();
  // Host metrics and the process listing are independent read-only queries, so they run concurrently.
  const [host, processes] = await Promise.all([readHostMetrics(), listProcessesCached()]);
  const snapshot: SystemSnapshot = { timestamp: new Date().toISOString(), cpu, memoryUsed: total - os.freemem(), memoryTotal: total, diskUsed: host.diskUsed, networkRx: host.networkRx, networkTx: host.networkTx, processCount: processes.length, source: process.platform === 'win32' ? 'Windows system APIs' : 'Portable OS APIs' };
  history.push(snapshot);
  if (history.length > 60) history.shift();
  return snapshot;
}

export function getSystemHistory(): SystemSnapshot[] { return [...history]; }

function calculateCpu(previous: os.CpuInfo[], current: os.CpuInfo[]): number {
  let idle = 0; let total = 0;
  current.forEach((cpu, index) => { const old = previous[index]; const oldTimes = old?.times ?? { idle: 0, user: 0, nice: 0, sys: 0, irq: 0 }; const oldTotal = Object.values(oldTimes).reduce((sum, value) => sum + value, 0); const newTotal = Object.values(cpu.times).reduce((sum, value) => sum + value, 0); idle += cpu.times.idle - oldTimes.idle; total += newTotal - oldTotal; });
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}
