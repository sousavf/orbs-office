import { describe, expect, test } from 'bun:test';
import { isLocalAddress, isMetricsAllowed, newCounters, renderMetrics } from './metrics';

const TOKEN = 'm'.repeat(40);
const headers = (init: Record<string, string> = {}): Headers => new Headers(init);

describe('metrics access', () => {
  test('refuses everything when nothing is configured', async () => {
    expect(await isMetricsAllowed({ token: null, allowLoopback: false }, headers(), '127.0.0.1')).toBe(false);
  });
  test('a correct bearer token is enough, a wrong one is not', async () => {
    const access = { token: TOKEN, allowLoopback: false };
    expect(await isMetricsAllowed(access, headers({ Authorization: `Bearer ${TOKEN}` }), '203.0.113.9')).toBe(true);
    expect(await isMetricsAllowed(access, headers({ Authorization: 'Bearer nope' }), '127.0.0.1')).toBe(false);
  });
  test('loopback is allowed only without proxy or Cloudflare headers', async () => {
    const access = { token: null, allowLoopback: true };
    expect(await isMetricsAllowed(access, headers(), '127.0.0.1')).toBe(true);
    expect(await isMetricsAllowed(access, headers(), '172.18.0.1')).toBe(true);
    expect(await isMetricsAllowed(access, headers({ 'CF-Connecting-IP': '198.51.100.7' }), '127.0.0.1')).toBe(false);
    expect(await isMetricsAllowed(access, headers({ 'X-Forwarded-For': '198.51.100.7' }), '127.0.0.1')).toBe(false);
    expect(await isMetricsAllowed(access, headers(), '203.0.113.9')).toBe(false);
    expect(await isMetricsAllowed(access, headers(), null)).toBe(false);
  });
  test('classifies local addresses', () => {
    expect(isLocalAddress('::1')).toBe(true);
    expect(isLocalAddress('::ffff:10.0.0.4')).toBe(true);
    expect(isLocalAddress('172.32.0.1')).toBe(false);
    expect(isLocalAddress('8.8.8.8')).toBe(false);
  });
});

describe('metrics text', () => {
  test('renders gauges and counters; omits the snapshot age before the first snapshot', () => {
    const counters = newCounters();
    counters.rejections.busy = 2;
    const text = renderMetrics(counters, { viewers: 3, displayedViewers: 7, publisherConnected: true, snapshotAgeSeconds: null });
    expect(text).toContain('orbs_office_viewers 3\n');
    expect(text).toContain('orbs_office_viewers_total 7\n');
    expect(text).toContain('orbs_office_viewer_rejections_total{reason="busy"} 2\n');
    expect(text).toContain('orbs_office_publisher_connected 1\n');
    expect(text).not.toContain('orbs_office_snapshot_age_seconds ');
  });
});
