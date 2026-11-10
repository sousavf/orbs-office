// `bridge metrics`: prints the stored viewer series. Read-only; it never starts the bridge or touches a relay.

import { downsample, formatReport, parseReportArgs, summarize } from './metrics-report';
import { metricsDir, readMetrics } from './metrics-store';

export function runMetricsReport(args: readonly string[], log: (line: string) => void): void {
  const options = parseReportArgs(args, Date.now());
  if (!options.ok) {
    log(`${options.error}\nusage: bridge metrics [--since 7d|24h|2026-11-01] [--until ...] [--step 1m|5m|1h|1d] [--format table|csv|json]`);
    process.exit(2);
  }
  const { since, until, stepMs, format } = options.value;
  const records = readMetrics(metricsDir(), since, until);
  console.log(formatReport(downsample(records, stepMs), summarize(records), format));
}
