import { readFileSync } from 'node:fs';
import { analysisThresholds } from './analysisService.js';
import type { ServiceMeta } from './types.js';

const isWindows = process.platform === 'win32';

/** Exposes the thresholds and collection capabilities the client should describe in its interface. */
export function getServiceMeta(): ServiceMeta {
  return {
    version: readVersion(),
    platform: process.platform,
    source: isWindows ? 'Windows system APIs' : 'Portable OS APIs',
    readOnly: true,
    thresholds: { cpuPercent: analysisThresholds.cpuPercent, memoryBytes: analysisThresholds.memoryBytes, children: analysisThresholds.children },
    capabilities: { diskUsage: isWindows, networkRates: isWindows, processOwner: isWindows, networkConnections: isWindows }
  };
}

/** Reads the package version rather than duplicating it, so the reported version cannot drift. */
function readVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof (parsed as { version?: unknown }).version === 'string') return (parsed as { version: string }).version;
  } catch { /* fall through to the unknown-version marker */ }
  return 'unknown';
}