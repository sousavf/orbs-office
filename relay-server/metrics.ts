// Optional local metrics of the standalone relay: Prometheus text format and the rule for who may read it.
// Nothing here identifies a visitor: only counts, no labels with addresses or hostnames.

import { isAuthorizedBearer } from '../shared/relay-http';

export interface MetricsCounters {
  viewerConnections: number;
  rejections: { busy: number; origin: number; ip: number };
  frames: { accepted: number; invalid: number; rate_limited: number };
}

export const newCounters = (): MetricsCounters => ({
  viewerConnections: 0,
  rejections: { busy: 0, origin: 0, ip: 0 },
  frames: { accepted: 0, invalid: 0, rate_limited: 0 },
});

export interface MetricsGauges {
  /** Open viewer sockets on this relay. */
  viewers: number;
  /** What viewers are shown (the synced cross-relay total while fresh, else the local count). */
  displayedViewers: number;
  publisherConnected: boolean;
  /** Seconds since the newest snapshot frame arrived, or null before the first. */
  snapshotAgeSeconds: number | null;
}

export function renderMetrics(counters: MetricsCounters, gauges: MetricsGauges): string {
  const lines: string[] = [];
  const metric = (name: string, type: 'gauge' | 'counter', help: string, samples: ReadonlyArray<readonly [string, number]>): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) lines.push(`${name}${labels} ${value}`);
  };
  metric('orbs_office_viewers', 'gauge', 'Viewer sockets open on this relay.', [['', gauges.viewers]]);
  metric('orbs_office_viewers_total', 'gauge', 'Viewer total currently displayed (synced across relays while fresh).', [['', gauges.displayedViewers]]);
  metric('orbs_office_viewer_connections_total', 'counter', 'Viewer connections admitted since start.', [['', counters.viewerConnections]]);
  metric('orbs_office_viewer_rejections_total', 'counter', 'Viewer connections refused since start.', [
    ['{reason="busy"}', counters.rejections.busy],
    ['{reason="origin"}', counters.rejections.origin],
    ['{reason="ip"}', counters.rejections.ip],
  ]);
  metric('orbs_office_publisher_connected', 'gauge', '1 while a publisher is connected.', [['', gauges.publisherConnected ? 1 : 0]]);
  metric('orbs_office_publisher_frames_total', 'counter', 'Publisher frames since start, by result.', [
    ['{result="accepted"}', counters.frames.accepted],
    ['{result="invalid"}', counters.frames.invalid],
    ['{result="rate_limited"}', counters.frames.rate_limited],
  ]);
  if (gauges.snapshotAgeSeconds !== null) {
    metric('orbs_office_snapshot_age_seconds', 'gauge', 'Seconds since the newest snapshot frame arrived.', [['', gauges.snapshotAgeSeconds]]);
  }
  return `${lines.join('\n')}\n`;
}

export interface MetricsAccess {
  /** Bearer token that always grants access. */
  token: string | null;
  /** Also grant access to loopback and private-network peers that are not behind Cloudflare. */
  allowLoopback: boolean;
}

/** Any of these means the request came through a proxy or tunnel, whatever its socket address says. */
const FORWARDING_HEADERS = ['cf-connecting-ip', 'cf-connecting-ipv6', 'cf-ray', 'cf-ipcountry', 'cf-visitor', 'cf-worker', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'];

export function isLocalAddress(address: string | null): boolean {
  if (address === null) return false;
  const text = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (text === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(text) || /^fe[89ab][0-9a-f]:/i.test(text)) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(text);
  if (match === null) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** The server refuses /metrics itself; the tunnel should not route it either. */
export async function isMetricsAllowed(access: MetricsAccess, headers: Headers, remoteAddress: string | null): Promise<boolean> {
  if (access.token !== null && (await isAuthorizedBearer(headers.get('Authorization'), access.token))) return true;
  if (!access.allowLoopback) return false;
  if (FORWARDING_HEADERS.some((name) => headers.has(name))) return false;
  return isLocalAddress(remoteAddress);
}
