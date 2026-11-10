// Viewer metrics on disk: ~/.config/orbs-office/metrics/viewers-YYYY-MM.jsonl, directory 0700, files 0600.

import { appendFileSync, chmodSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { configPath, ensurePrivateDir } from '../shared/settings-file';
import { expiredMetricsFiles, isMetricsFile, metricsFileName, parseMetricsLine } from './metrics';
import type { MetricsRecord } from './metrics';

export const metricsDir = (): string => configPath('metrics');

/** One append of one complete line, so a crash leaves at worst a torn last line, which the reader skips. */
export function appendMetricsRecord(dir: string, record: MetricsRecord): void {
  ensurePrivateDir(dir);
  const path = join(dir, metricsFileName(Date.parse(record.t)));
  const created = !existsSync(path);
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (created) chmodSync(path, 0o600);
}

/** Deletes monthly files older than the retention window; returns the names removed. */
export function pruneMetrics(dir: string, now: number, days: number): string[] {
  if (!existsSync(dir)) return [];
  const expired = expiredMetricsFiles(readdirSync(dir), now, days);
  for (const name of expired) unlinkSync(join(dir, name));
  return expired;
}

/** Records with `since <= t < until` (epoch ms), oldest first. Missing directory reads as no data. */
export function readMetrics(dir: string, since: number, until: number): MetricsRecord[] {
  if (!existsSync(dir)) return [];
  const records: MetricsRecord[] = [];
  for (const name of readdirSync(dir).filter(isMetricsFile).sort()) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const record = line.length === 0 ? null : parseMetricsLine(line);
      if (record === null) continue;
      const at = Date.parse(record.t);
      if (at >= since && at < until) records.push(record);
    }
  }
  return records.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}
