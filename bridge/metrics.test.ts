import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMinuteAggregator, expiredMetricsFiles, metricsFileName, parseMetricsLine } from './metrics';
import type { ViewerSample } from './metrics';
import { appendMetricsRecord, pruneMetrics, readMetrics } from './metrics-store';

const at = (iso: string): number => Date.parse(iso);
const sample = (total: number, relays: Record<string, number>, connected: string[]): ViewerSample => ({ total, relays, connected });

describe('minute aggregator', () => {
  test('emits the last total, the peak and the latest relay state when the minute ends', () => {
    const aggregator = createMinuteAggregator();
    expect(aggregator.record(at('2026-11-10T20:31:05Z'), sample(10, { a: 10, b: 0 }, ['a']))).toEqual([]);
    aggregator.record(at('2026-11-10T20:31:20Z'), sample(15, { a: 12, b: 3 }, ['a', 'b']));
    aggregator.record(at('2026-11-10T20:31:50Z'), sample(12, { a: 12, b: 0 }, ['a']));
    const done = aggregator.record(at('2026-11-10T20:32:01Z'), sample(11, { a: 11, b: 0 }, ['a']));
    expect(done).toEqual([{ t: '2026-11-10T20:31:00Z', total: 12, max: 15, relays: { a: 12, b: 0 }, connected: ['a'] }]);
  });
  test('writes nothing for a minute with no relay connected', () => {
    const aggregator = createMinuteAggregator();
    aggregator.record(at('2026-11-10T20:31:05Z'), sample(0, { a: 0 }, []));
    expect(aggregator.record(at('2026-11-10T20:32:05Z'), sample(0, { a: 0 }, []))).toEqual([]);
  });
  test('a gap of silent minutes yields only the minutes that were sampled', () => {
    const aggregator = createMinuteAggregator();
    aggregator.record(at('2026-11-10T20:31:05Z'), sample(2, { a: 2 }, ['a']));
    const done = aggregator.record(at('2026-11-10T20:40:00Z'), sample(3, { a: 3 }, ['a']));
    expect(done).toHaveLength(1);
    expect(aggregator.record(at('2026-11-10T20:41:00Z'), sample(3, { a: 3 }, ['a']))[0]?.t).toBe('2026-11-10T20:40:00Z');
  });
  test('ignores a sample from before the current minute', () => {
    const aggregator = createMinuteAggregator();
    aggregator.record(at('2026-11-10T20:31:05Z'), sample(2, { a: 2 }, ['a']));
    expect(aggregator.record(at('2026-11-10T20:30:00Z'), sample(99, { a: 99 }, ['a']))).toEqual([]);
    expect(aggregator.record(at('2026-11-10T20:32:00Z'), sample(2, { a: 2 }, ['a']))[0]?.max).toBe(2);
  });
});

describe('retention', () => {
  test('names UTC monthly files', () => {
    expect(metricsFileName(at('2026-11-30T23:59:59Z'))).toBe('viewers-2026-11.jsonl');
  });
  test('removes only months that end before the window and ignores other files', () => {
    const names = ['viewers-2025-09.jsonl', 'viewers-2025-10.jsonl', 'viewers-2026-11.jsonl', 'notes.txt'];
    expect(expiredMetricsFiles(names, at('2026-11-10T00:00:00Z'), 400)).toEqual(['viewers-2025-09.jsonl']);
  });
});

describe('store', () => {
  test('appends private lines, reads them back and prunes old months', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'metrics-test-')), 'metrics');
    try {
      appendMetricsRecord(dir, { t: '2026-11-10T20:31:00Z', total: 4, max: 5, relays: { a: 4 }, connected: ['a'] });
      appendMetricsRecord(dir, { t: '2026-11-10T20:32:00Z', total: 6, max: 6, relays: { a: 6 }, connected: ['a'] });
      writeFileSync(join(dir, 'viewers-2024-01.jsonl'), '{"t":"2024-01-01T00:00:00Z","total":1,"max":1,"relays":{},"connected":[]}\n');
      const file = join(dir, 'viewers-2026-11.jsonl');
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(readFileSync(file, 'utf8').split('\n')).toHaveLength(3);
      expect(readMetrics(dir, at('2026-11-10T20:32:00Z'), at('2026-11-11T00:00:00Z')).map((r) => r.total)).toEqual([6]);
      expect(pruneMetrics(dir, at('2026-11-10T21:00:00Z'), 400)).toEqual(['viewers-2024-01.jsonl']);
      expect(readdirSync(dir)).toEqual(['viewers-2026-11.jsonl']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('skips torn or foreign lines', () => {
    expect(parseMetricsLine('{"t":"2026-11-10T20:31:00Z","total":4')).toBeNull();
    expect(parseMetricsLine('{"t":"x","total":1,"max":1,"relays":{},"connected":[]}')).toBeNull();
  });
});
