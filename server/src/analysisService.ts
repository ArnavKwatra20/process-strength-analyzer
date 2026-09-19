import type { AnalysisObservation, ProcessRecord } from './types.js';

export function analyzeProcess(process: ProcessRecord, childCount: number): { level: 'NORMAL' | 'REVIEW' | 'ELEVATED'; score: number; observations: AnalysisObservation[] } {
  const observations: AnalysisObservation[] = [];
  if ((process.cpu ?? 0) > 75) observations.push({ severity: 'HIGH', title: 'High CPU usage', reason: 'Process CPU usage is above the configured review threshold.', observed: `${process.cpu}%`, threshold: '75%', recommendation: 'Inspect the process activity and recent workload.' });
  if ((process.memory ?? 0) > 1024 * 1024 * 1024) observations.push({ severity: 'MEDIUM', title: 'High memory usage', reason: 'Process working set is above the configured review threshold.', observed: `${Math.round((process.memory ?? 0) / 1024 / 1024)} MB`, threshold: '1024 MB', recommendation: 'Review open projects, documents, or workload associated with this process.' });
  if (process.path && !/^(C:\\Windows|C:\\Program Files|C:\\Program Files \(x86\))/i.test(process.path)) observations.push({ severity: 'LOW', title: 'Unusual executable location', reason: 'The executable is outside common Windows application directories.', observed: process.path, threshold: 'Windows or Program Files', recommendation: 'Confirm the path is expected for the installed application.' });
  if (childCount >= 8) observations.push({ severity: 'LOW', title: 'Many child processes', reason: 'This process currently owns a relatively large child process set.', observed: String(childCount), threshold: '8 children', recommendation: 'Review the process tree to understand the workload it launched.' });
  const score = Math.max(0, 100 - observations.reduce((total, item) => total + (item.severity === 'HIGH' ? 35 : item.severity === 'MEDIUM' ? 20 : 8), 0));
  return { level: score < 60 ? 'ELEVATED' : score < 85 ? 'REVIEW' : 'NORMAL', score, observations };
}
