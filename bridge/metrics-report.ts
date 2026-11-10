// `bridge metrics`: pure helpers behind the read-only report (argument parsing, downsampling, formatting).

import { isoSeconds, MINUTE_MS } from './metrics';
import type { MetricsRecord } from './metrics';

export type ReportFormat = 'table' | 'csv' | 'json';

export interface ReportOptions {
  since: number;
  until: number;
  stepMs: number;
  format: ReportFormat;
}

export interface Row {
  t: string;
  avg: number;
  max: number;
  /** Samples (minutes with data) in the step. */
  minutes: number;
}

export interface Summary {
  peak: { value: number; t: string } | null;
  average: number;
  viewerMinutes: number;
  minutes: number;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UNITS: Record<string, number> = { m: MINUTE_MS, h: 60 * MINUTE_MS, d: 24 * 60 * MINUTE_MS };
const round = (n: number): number => Math.round(n * 100) / 100;

/** `7d`, `24h`, `90m`, or a date such as `2026-11-01` / a full ISO time (UTC when no zone is given). */
export function parseTimeSpec(spec: string, now: number): Parsed<number> {
  const relative = /^(\d+)([mhd])$/.exec(spec);
  if (relative !== null) return { ok: true, value: now - Number(relative[1]) * (UNITS[relative[2] ?? 'm'] ?? MINUTE_MS) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(spec)) return { ok: true, value: Date.parse(`${spec}T00:00:00Z`) };
  const text = /(Z|[+-]\d{2}:\d{2})$/.test(spec) ? spec : `${spec}Z`;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? { ok: false, error: `cannot read time "${spec}"; use 7d, 24h, 2026-11-01 or an ISO time` } : { ok: true, value: parsed };
}

const STEPS: Record<string, number> = { '1m': MINUTE_MS, '5m': 5 * MINUTE_MS, '1h': 60 * MINUTE_MS, '1d': 24 * 60 * MINUTE_MS };

export function parseReportArgs(args: readonly string[], now: number): Parsed<ReportOptions> {
  const flag = (name: string): string | null => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  };
  const since = parseTimeSpec(flag('since') ?? '7d', now);
  if (!since.ok) return since;
  const until = parseTimeSpec(flag('until') ?? '0m', now);
  if (!until.ok) return until;
  const step = flag('step') ?? '1h';
  const stepMs = STEPS[step];
  if (stepMs === undefined) return { ok: false, error: `--step must be one of ${Object.keys(STEPS).join(', ')}` };
  const format = flag('format') ?? 'table';
  if (format !== 'table' && format !== 'csv' && format !== 'json') return { ok: false, error: '--format must be table, csv or json' };
  if (until.value <= since.value) return { ok: false, error: '--until must be after --since' };
  return { ok: true, value: { since: since.value, until: until.value, stepMs, format } };
}

/** Groups records into UTC-aligned steps; `avg` is the mean total per sampled minute, `max` the peak. */
export function downsample(records: readonly MetricsRecord[], stepMs: number): Row[] {
  const groups = new Map<number, { sum: number; max: number; minutes: number }>();
  for (const record of records) {
    const key = Math.floor(Date.parse(record.t) / stepMs) * stepMs;
    const group = groups.get(key) ?? { sum: 0, max: 0, minutes: 0 };
    group.sum += record.total;
    group.max = Math.max(group.max, record.max);
    group.minutes += 1;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, group]) => ({ t: isoSeconds(key), avg: round(group.sum / group.minutes), max: group.max, minutes: group.minutes }));
}

export function summarize(records: readonly MetricsRecord[]): Summary {
  let peak: Summary['peak'] = null;
  let viewerMinutes = 0;
  for (const record of records) {
    viewerMinutes += record.total;
    if (peak === null || record.max > peak.value) peak = { value: record.max, t: record.t };
  }
  return { peak, average: records.length === 0 ? 0 : round(viewerMinutes / records.length), viewerMinutes, minutes: records.length };
}

export function summaryLine(summary: Summary): string {
  if (summary.peak === null) return 'no data in this range';
  return `peak ${summary.peak.value} at ${summary.peak.t}, average ${summary.average}, viewer-minutes ${summary.viewerMinutes} over ${summary.minutes} sampled minutes`;
}

export function formatReport(rows: readonly Row[], summary: Summary, format: ReportFormat): string {
  if (format === 'json') return JSON.stringify({ rows, summary }, null, 2);
  if (format === 'csv') return ['t,avg,max,minutes', ...rows.map((row) => `${row.t},${row.avg},${row.max},${row.minutes}`)].join('\n');
  const header = ['time (UTC)', 'avg', 'max', 'minutes'];
  const body = rows.map((row) => [row.t, String(row.avg), String(row.max), String(row.minutes)]);
  const widths = header.map((title, column) => Math.max(title.length, ...body.map((line) => line[column]?.length ?? 0)));
  const pad = (cells: readonly string[]): string => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[0] ?? 0) : cell.padStart(widths[column] ?? 0))).join('  ');
  return [pad(header), ...body.map(pad), '', summaryLine(summary)].join('\n');
}
