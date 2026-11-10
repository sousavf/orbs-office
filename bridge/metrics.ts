// Viewer-count time series, pure part: folds samples of the synced viewer total into one record per UTC minute.
// Time comes in through the samples, so tests need no clock. File access lives in metrics-store.ts.

export interface ViewerSample {
  /** The synced total over the connected relays. */
  total: number;
  /** Latest viewer count per configured relay name; 0 for a relay that is down or has not reported. */
  relays: Record<string, number>;
  /** Relays whose publisher socket is up. */
  connected: string[];
}

/** One JSONL line. Counts and relay names only: nothing about bots, visitors or addresses. */
export interface MetricsRecord extends ViewerSample {
  /** Start of the UTC minute, e.g. 2026-11-10T20:31:00Z. */
  t: string;
  /** Peak total seen during the minute. */
  max: number;
}

export const MINUTE_MS = 60_000;
export const DEFAULT_METRICS_DAYS = 400;
const FILE_PATTERN = /^viewers-(\d{4})-(\d{2})\.jsonl$/;

export const minuteStart = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/** `2026-11-10T20:31:00Z`: whole seconds, always UTC. */
export const isoSeconds = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;

export function metricsFileName(ms: number): string {
  const date = new Date(ms);
  return `viewers-${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
}

export interface MinuteAggregator {
  /**
   * Notes the state at `at` (epoch ms) and returns the records of the minutes that ended before it. A minute in
   * which no relay was connected at any sample yields no record: a gap in the file means the bridge was offline.
   * A sample from before the current minute (the clock went back) is ignored.
   */
  record(at: number, sample: ViewerSample): MetricsRecord[];
}

interface Bucket {
  minute: number;
  last: ViewerSample;
  max: number;
  anyConnected: boolean;
}

export function createMinuteAggregator(): MinuteAggregator {
  let bucket: Bucket | null = null;

  const finish = (done: Bucket): MetricsRecord[] =>
    done.anyConnected
      ? [{ t: isoSeconds(done.minute), total: done.last.total, max: done.max, relays: done.last.relays, connected: done.last.connected }]
      : [];

  return {
    record(at, sample) {
      const minute = minuteStart(at);
      let finished: MetricsRecord[] = [];
      if (bucket !== null && minute < bucket.minute) return finished;
      if (bucket !== null && minute > bucket.minute) {
        finished = finish(bucket);
        bucket = null;
      }
      const copy: ViewerSample = { total: sample.total, relays: { ...sample.relays }, connected: [...sample.connected] };
      bucket = {
        minute,
        last: copy,
        max: Math.max(bucket?.max ?? 0, sample.total),
        anyConnected: (bucket?.anyConnected ?? false) || sample.connected.length > 0,
      };
      return finished;
    },
  };
}

/**
 * Monthly files that lie entirely before `now - days`. A month is kept while any part of it is inside the window.
 * Names that do not match the pattern are never listed.
 */
export function expiredMetricsFiles(names: readonly string[], now: number, days: number): string[] {
  const cutoff = now - days * 24 * 60 * MINUTE_MS;
  return names.filter((name) => {
    const match = FILE_PATTERN.exec(name);
    if (match === null) return false;
    const monthEnd = Date.UTC(Number(match[1]), Number(match[2]), 1);
    return monthEnd <= cutoff;
  });
}

export function isMetricsFile(name: string): boolean {
  return FILE_PATTERN.test(name);
}

/** Validates one JSONL line; anything off-schema is skipped by the reader rather than trusted. */
export function parseMetricsLine(line: string): MetricsRecord | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null) return null;
    const { t, total, max, relays, connected } = value as Record<string, unknown>;
    if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) return null;
    if (typeof total !== 'number' || typeof max !== 'number') return null;
    if (typeof relays !== 'object' || relays === null || !Array.isArray(connected)) return null;
    return { t, total, max, relays: relays as Record<string, number>, connected: connected.filter((name): name is string => typeof name === 'string') };
  } catch {
    return null;
  }
}
