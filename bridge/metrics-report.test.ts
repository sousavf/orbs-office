import { describe, expect, test } from 'bun:test';
import type { MetricsRecord } from './metrics';
import { downsample, formatReport, parseReportArgs, parseTimeSpec, summarize, summaryLine } from './metrics-report';

const now = Date.parse('2026-11-10T12:00:00Z');
const rec = (t: string, total: number, max: number): MetricsRecord => ({ t, total, max, relays: {}, connected: ['a'] });
const records = [rec('2026-11-10T10:00:00Z', 2, 3), rec('2026-11-10T10:01:00Z', 4, 9), rec('2026-11-10T11:00:00Z', 1, 1)];

describe('report', () => {
  test('parses relative, date and ISO times', () => {
    expect(parseTimeSpec('24h', now)).toEqual({ ok: true, value: now - 24 * 3_600_000 });
    expect(parseTimeSpec('2026-11-01', now)).toEqual({ ok: true, value: Date.parse('2026-11-01T00:00:00Z') });
    expect(parseTimeSpec('nonsense', now).ok).toBe(false);
  });
  test('rejects a bad step, format or range', () => {
    expect(parseReportArgs(['--step', '2m'], now).ok).toBe(false);
    expect(parseReportArgs(['--format', 'xml'], now).ok).toBe(false);
    expect(parseReportArgs(['--since', '2026-12-01'], now).ok).toBe(false);
  });
  test('downsamples with average, max and sample count', () => {
    expect(downsample(records, 3_600_000)).toEqual([
      { t: '2026-11-10T10:00:00Z', avg: 3, max: 9, minutes: 2 },
      { t: '2026-11-10T11:00:00Z', avg: 1, max: 1, minutes: 1 },
    ]);
  });
  test('summarizes peak, average and viewer-minutes', () => {
    const summary = summarize(records);
    expect(summary).toEqual({ peak: { value: 9, t: '2026-11-10T10:01:00Z' }, average: 2.33, viewerMinutes: 7, minutes: 3 });
    expect(summaryLine(summarize([]))).toBe('no data in this range');
  });
  test('csv has a header and one line per step', () => {
    const csv = formatReport(downsample(records, 3_600_000), summarize(records), 'csv');
    expect(csv.split('\n')[0]).toBe('t,avg,max,minutes');
    expect(csv.split('\n')).toHaveLength(3);
  });
});
