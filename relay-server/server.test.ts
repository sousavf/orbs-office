import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRelayServer } from './server';
import type { RelayServer } from './server';
import type { RelayServerConfig } from './config';

const TOKEN = 't'.repeat(48);
const PAGE = 'https://office.example';
const BOT = {
  id: 'aaaaaaaaaaaaaaaa', name: 'Agent 01', color: '#3b93f0', figure: 'male', island: 'auto', rank: 0,
  activity: { kind: 'idle' }, subagents: 0, runStartedAgoSec: null,
};
const SNAPSHOT = JSON.stringify({ t: 'snapshot', snapshot: { v: 1, at: 10_000, bots: [BOT] } });

type HeaderWebSocket = new (url: string, options: { headers: Record<string, string> }) => WebSocket;
const HeaderSocket = WebSocket as unknown as HeaderWebSocket;

let dataDir = '';
let server: RelayServer | null = null;

const config = (): RelayServerConfig => ({ host: '127.0.0.1', port: 0, publishToken: TOKEN, allowedOrigins: [PAGE], trustProxy: null, dataDir, metricsToken: null, metricsAllowLoopback: false });
const start = (): RelayServer => startRelayServer(config(), () => {}, Date.now, { countCoalesceMs: 40, maxViewersPerIp: 2 });
const base = (): string => `127.0.0.1:${server?.port ?? 0}`;

interface Client {
  ws: WebSocket;
  frames: string[];
  closed: Promise<number>;
  opened: Promise<void>;
}

function connect(path: string, headers: Record<string, string> = {}): Client {
  const ws = new HeaderSocket(`ws://${base()}${path}`, { headers });
  const frames: string[] = [];
  ws.addEventListener('message', (event) => frames.push(String(event.data)));
  const opened = new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()));
  const closed = new Promise<number>((resolve) => ws.addEventListener('close', (event) => resolve(event.code)));
  return { ws, frames, closed, opened };
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const publisher = (): Client => connect('/publish', { Authorization: `Bearer ${TOKEN}` });
const viewer = (): Client => connect('/live', { Origin: PAGE });

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  server = start();
});

afterEach(async () => {
  await server?.stop();
  server = null;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('http', () => {
  test('healthz answers ok with security headers and no data', async () => {
    const response = await fetch(`http://${base()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  test('json endpoints are cached for 5 s and readable only from listed origins', async () => {
    const allowed = await fetch(`http://${base()}/state.json`, { headers: { Origin: PAGE } });
    expect(allowed.headers.get('cache-control')).toBe('public, max-age=5');
    expect(allowed.headers.get('access-control-allow-origin')).toBe(PAGE);
    expect(((await allowed.json()) as { viewers: number }).viewers).toBe(0);
    const foreign = await fetch(`http://${base()}/viewers.json`, { headers: { Origin: 'https://evil.example' } });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    expect(await (await fetch(`http://${base()}/snapshot.json`)).json()).toEqual({ v: 1, at: 0, bots: [] });
  });

  test('unknown paths are 404 and writes are refused', async () => {
    expect((await fetch(`http://${base()}/nope`)).status).toBe(404);
    expect((await fetch(`http://${base()}/state.json`, { method: 'POST' })).status).toBe(405);
  });
});

describe('publisher', () => {
  test('needs the right bearer token', async () => {
    const wrong = connect('/publish', { Authorization: `Bearer ${'x'.repeat(48)}` });
    await wrong.closed;
    expect(wrong.frames).toEqual([]);
    const good = publisher();
    await good.opened;
    good.ws.close();
  });

  test('snapshots reach viewers and are served by state.json', async () => {
    const pub = publisher();
    await pub.opened;
    const view = viewer();
    await view.opened;
    pub.ws.send(SNAPSHOT);
    await until(() => view.frames.includes(SNAPSHOT), 'snapshot on the viewer');
    const state = (await (await fetch(`http://${base()}/state.json`)).json()) as { snapshot: { bots: unknown[] } };
    expect(state.snapshot.bots).toHaveLength(1);
    view.ws.close();
    pub.ws.close();
  });

  test('a restart serves the last snapshot from the data file', async () => {
    const pub = publisher();
    await pub.opened;
    pub.ws.send(SNAPSHOT);
    await until(() => {
      try {
        return readFileSync(join(dataDir, 'snapshot.json'), 'utf8') === SNAPSHOT;
      } catch {
        return false;
      }
    }, 'persisted file');
    pub.ws.close();
    await pub.closed;
    await server?.stop();
    server = start();
    const state = (await (await fetch(`http://${base()}/state.json`)).json()) as { snapshot: { at: number } };
    expect(state.snapshot.at).toBe(10_000);
  });
});

describe('viewers', () => {
  test('answer ping with pong and get the latest state first', async () => {
    const view = viewer();
    await view.opened;
    await until(() => view.frames.length >= 2, 'hello frames');
    expect(view.frames[1]).toBe('{"t":"viewers","n":1}');
    view.ws.send('ping');
    await until(() => view.frames.includes('pong'), 'pong');
    view.ws.close();
  });

  test('a foreign Origin is refused', async () => {
    const view = connect('/live', { Origin: 'https://evil.example' });
    let opened = false;
    view.opened.then(() => (opened = true), () => undefined);
    await view.closed;
    expect(opened).toBe(false);
  });

  test('the per-IP cap closes extra viewers with the busy code', async () => {
    const first = viewer();
    const second = viewer();
    await Promise.all([first.opened, second.opened]);
    const third = viewer();
    expect(await third.closed).toBe(4429);
    first.ws.close();
    second.ws.close();
  });

  test('a stream of viewer frames closes the socket', async () => {
    const view = viewer();
    await view.opened;
    for (let i = 0; i < 12; i += 1) view.ws.send('hello');
    expect(await view.closed).toBe(1008);
  });
});

describe('synced viewer total', () => {
  test('the relay reports its count to the publisher and shows the total the publisher sends', async () => {
    const pub = publisher();
    await pub.opened;
    await until(() => pub.frames.includes('{"t":"count","n":0}'), 'initial count');
    const view = viewer();
    await view.opened;
    await until(() => pub.frames.includes('{"t":"count","n":1}'), 'count of 1');
    pub.ws.send('{"t":"viewers","n":12}');
    await until(() => view.frames.includes('{"t":"viewers","n":12}'), 'shared total on the viewer');
    expect(((await (await fetch(`http://${base()}/viewers.json`)).json()) as { n: number }).n).toBe(12);
    pub.ws.close();
    await pub.closed;
    await until(() => view.frames.at(-1) === '{"t":"viewers","n":1}', 'fall back to the local count');
    view.ws.close();
  });
});

describe('metrics endpoint', () => {
  const METRICS_TOKEN = 'q'.repeat(40);

  test('is absent unless a token or loopback access is configured', async () => {
    expect((await fetch(`http://${base()}/metrics`)).status).toBe(404);
  });

  test('serves counters to the token holder and to loopback, but not to tunnel traffic', async () => {
    await server?.stop();
    server = startRelayServer({ ...config(), metricsToken: METRICS_TOKEN, metricsAllowLoopback: true }, () => {}, Date.now, { countCoalesceMs: 40 });
    const view = viewer();
    await view.opened;
    const pub = publisher();
    await pub.opened;
    pub.ws.send(SNAPSHOT);
    pub.ws.send('not json');
    await until(() => view.frames.includes(SNAPSHOT), 'snapshot');
    const local = await fetch(`http://${base()}/metrics`);
    const text = await local.text();
    expect(local.status).toBe(200);
    expect(text).toContain('orbs_office_viewers 1\n');
    expect(text).toContain('orbs_office_viewer_connections_total 1\n');
    expect(text).toContain('orbs_office_publisher_frames_total{result="accepted"} 1\n');
    expect(text).toContain('orbs_office_publisher_frames_total{result="invalid"} 1\n');
    expect(text).toContain('orbs_office_publisher_connected 1\n');
    const tunnel = await fetch(`http://${base()}/metrics`, { headers: { 'CF-Connecting-IP': '198.51.100.7' } });
    expect(tunnel.status).toBe(404);
    const withToken = await fetch(`http://${base()}/metrics`, { headers: { 'CF-Connecting-IP': '198.51.100.7', Authorization: `Bearer ${METRICS_TOKEN}` } });
    expect(withToken.status).toBe(200);
    view.ws.close();
    pub.ws.close();
  });
});
