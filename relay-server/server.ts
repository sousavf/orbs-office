// Standalone relay: Bun.serve + WebSockets as a thin adapter over the shared relay core (shared/relay-core.ts).
// The Cloudflare Durable Object is the other adapter over the same core, so limits and behaviour are identical.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUSY_CLOSE_CODE, DEFAULT_RELAY_LIMITS, REPLACED_CLOSE_CODE, createRelayCore } from '../shared/relay-core';
import { corsHeaders, isAuthorizedBearer, isOriginAllowed } from '../shared/relay-http';
import { apiSecurityHeaders } from '../shared/security-headers';
import type { RelayLimits } from '../shared/relay-core';
import type { RelayServerConfig } from './config';
import { isMetricsAllowed, newCounters, renderMetrics } from './metrics';

export type RelayLog = (event: string, fields?: Record<string, string | number>) => void;

interface SocketData {
  role: 'viewer' | 'publisher';
  ip: string;
  messages: number;
  /** True once the socket is in the registry; a refused viewer never is. */
  registered: boolean;
}

export interface RelayServer {
  readonly port: number;
  /** Persists the newest snapshot, closes every socket and stops listening. */
  stop(): Promise<void>;
}

const SNAPSHOT_FILE = 'snapshot.json';
/** A publish frame is at most 64 KB; a little headroom for the WebSocket layer, anything bigger drops the connection. */
const MAX_PAYLOAD_BYTES = 70 * 1024;
const JSON_CACHE_CONTROL = 'public, max-age=5';
const CLOSE_GOING_AWAY = 1001;

export function startRelayServer(
  config: RelayServerConfig,
  log: RelayLog,
  now: () => number = Date.now,
  limits?: Partial<RelayLimits>,
): RelayServer {
  const core = createRelayCore({ now, limits });
  const maxViewers = { ...DEFAULT_RELAY_LIMITS, ...limits }.maxViewers;
  const counters = newCounters();
  let lastSnapshotAt: number | null = null;
  const snapshotPath = join(config.dataDir, SNAPSHOT_FILE);
  mkdirSync(config.dataDir, { recursive: true });
  if (existsSync(snapshotPath)) {
    try {
      core.restore(readFileSync(snapshotPath, 'utf8'));
    } catch {
      log('restore_failed');
    }
  }

  const viewers = new Set<BunServerWebSocket<SocketData>>();
  const viewersPerIp = new Map<string, number>();
  let publisher: BunServerWebSocket<SocketData> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;

  const writeSnapshot = (frame: string): void => {
    try {
      const temp = `${snapshotPath}.tmp`;
      writeFileSync(temp, frame, { mode: 0o600 });
      renameSync(temp, snapshotPath);
    } catch {
      log('persist_failed');
    }
  };

  const send = (socket: BunServerWebSocket<SocketData>, frame: string): void => {
    try {
      socket.send(frame);
    } catch {
      // The socket is going away; its close handler cleans up.
    }
  };

  const broadcast = (frame: string): void => {
    for (const viewer of viewers) send(viewer, frame);
  };

  /** Asks the core what is due and does it. Called after anything that can change a count or a deadline. */
  const settle = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const result = core.tick({ localViewers: viewers.size, publisherConnected: publisher !== null });
    if (result.viewersFrame !== null) broadcast(result.viewersFrame);
    if (result.countFrame !== null && publisher !== null) send(publisher, result.countFrame);
    if (result.persist !== null) writeSnapshot(result.persist);
    if (result.nextDueAt !== null && !stopping) {
      timer = setTimeout(settle, Math.max(0, result.nextDueAt - now()));
    }
  };

  const clientIp = (request: Request, server: BunServer): string => {
    if (config.trustProxy === 'cloudflare') {
      const forwarded = request.headers.get('cf-connecting-ip');
      if (forwarded !== null && forwarded.length > 0) return forwarded;
    }
    return server.requestIP(request)?.address ?? 'unknown';
  };

  const respond = (request: Request, status: number, body: string | null, headers: Record<string, string>): Response =>
    new Response(request.method === 'HEAD' ? null : body, {
      status,
      headers: { ...apiSecurityHeaders(), ...corsHeaders(request.headers.get('Origin'), config.allowedOrigins), ...headers },
    });

  const plain = (request: Request, status: number, body = ''): Response =>
    respond(request, status, body, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });

  const json = (request: Request, body: string): Response =>
    respond(request, 200, body, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': JSON_CACHE_CONTROL });

  const isWebSocketRequest = (request: Request): boolean => request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

  const server = Bun.serve<SocketData>({
    hostname: config.host,
    port: config.port,
    async fetch(request, bunServer) {
      const url = new URL(request.url);
      const isRead = request.method === 'GET' || request.method === 'HEAD';
      switch (url.pathname) {
        case '/healthz':
          return isRead ? plain(request, 200, 'ok') : plain(request, 405);
        case '/metrics': {
          // Refused as if absent unless explicitly permitted; checked before the method so nothing leaks.
          const allowed = await isMetricsAllowed(
            { token: config.metricsToken, allowLoopback: config.metricsAllowLoopback },
            request.headers,
            bunServer.requestIP(request)?.address ?? null,
          );
          if (!allowed) return plain(request, 404);
          if (!isRead) return plain(request, 405);
          const text = renderMetrics(counters, {
            viewers: viewers.size,
            displayedViewers: core.displayedViewers(viewers.size),
            publisherConnected: publisher !== null,
            snapshotAgeSeconds: lastSnapshotAt === null ? null : Math.max(0, Math.round((now() - lastSnapshotAt) / 1000)),
          });
          return new Response(request.method === 'HEAD' ? null : text, {
            headers: { ...apiSecurityHeaders(), 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        case '/state.json':
        case '/snapshot.json':
        case '/viewers.json': {
          if (request.method === 'OPTIONS') return respond(request, 204, null, { 'Access-Control-Allow-Methods': 'GET, HEAD' });
          if (!isRead) return plain(request, 405);
          const local = viewers.size;
          if (url.pathname === '/state.json') return json(request, core.stateBody(local));
          return json(request, url.pathname === '/snapshot.json' ? core.snapshotBody() : core.viewersBody(local));
        }
        case '/live': {
          if (request.method !== 'GET') return plain(request, 405);
          if (!isWebSocketRequest(request)) return plain(request, 426, 'WebSocket required');
          // Behind a tunnel the scheme and host the server sees may differ from what the browser used, so the page's own
          // origin must be listed in ALLOWED_ORIGINS.
          if (!isOriginAllowed(request.headers.get('Origin'), url.origin, config.allowedOrigins)) {
            counters.rejections.origin += 1;
            return plain(request, 403);
          }
          const data: SocketData = { role: 'viewer', ip: clientIp(request, bunServer), messages: 0, registered: false };
          return bunServer.upgrade(request, { data }) ? undefined : plain(request, 400);
        }
        case '/publish': {
          if (request.method !== 'GET') return plain(request, 405);
          if (!isWebSocketRequest(request)) return plain(request, 426, 'WebSocket required');
          if (!(await isAuthorizedBearer(request.headers.get('Authorization'), config.publishToken))) return plain(request, 401);
          const data: SocketData = { role: 'publisher', ip: 'publisher', messages: 0, registered: false };
          return bunServer.upgrade(request, { data }) ? undefined : plain(request, 400);
        }
        default:
          return plain(request, 404);
      }
    },
    websocket: {
      maxPayloadLength: MAX_PAYLOAD_BYTES,
      // Viewers ping every ~25 s and the publisher every ~20 s, so a socket silent for two minutes is dead.
      idleTimeout: 120,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      open(ws) {
        if (ws.data.role === 'publisher') {
          // The newest authenticated publisher wins: a dead half-open connection must never lock the real one out.
          const old = publisher;
          publisher = ws;
          ws.data.registered = true;
          old?.close(REPLACED_CLOSE_CODE, 'replaced by a newer publisher');
          core.onPublisherConnected();
          log('publisher_connected');
          settle();
          return;
        }
        const fromIp = viewersPerIp.get(ws.data.ip) ?? 0;
        if (core.admitViewer({ total: viewers.size, fromIp }) === 'busy') {
          counters.rejections[viewers.size >= maxViewers ? 'busy' : 'ip'] += 1;
          ws.close(BUSY_CLOSE_CODE, 'busy');
          return;
        }
        counters.viewerConnections += 1;
        ws.data.registered = true;
        viewers.add(ws);
        viewersPerIp.set(ws.data.ip, fromIp + 1);
        for (const frame of core.hello(viewers.size)) send(ws, frame);
        settle();
      },
      message(ws, message) {
        // The app-level heartbeat: answered before anything is counted or parsed, like the Worker's auto-response.
        if (message === 'ping') {
          send(ws, 'pong');
          return;
        }
        if (ws.data.role === 'publisher') {
          const result = core.onPublisherFrame(message);
          if (result.rateLimited) counters.frames.rate_limited += 1;
          else if (result.invalid !== null) counters.frames.invalid += 1;
          else {
            counters.frames.accepted += 1;
            if (result.forward?.includes('"t":"snapshot"') === true) lastSnapshotAt = now();
          }
          if (result.invalid !== null) log('invalid_publish', { reason: result.invalid.reason, total: result.invalid.total });
          if (result.close !== null) ws.close(result.close.code, result.close.reason);
          if (result.forward !== null) broadcast(result.forward);
          settle();
          return;
        }
        // Viewers are read-only: anything they send is ignored, and a stream of it closes the socket.
        const size = typeof message === 'string' ? message.length : message.byteLength;
        const verdict = core.onViewerMessage(size, ws.data.messages);
        ws.data.messages = verdict.messages;
        if (verdict.close) ws.close(1008, 'read-only endpoint');
      },
      close(ws) {
        if (!ws.data.registered) return;
        if (ws.data.role === 'publisher') {
          if (publisher === ws) {
            publisher = null;
            core.onPublisherGone();
            const pending = core.flushPersist();
            if (pending !== null) writeSnapshot(pending);
            log('publisher_disconnected');
          }
        } else {
          viewers.delete(ws);
          const remaining = (viewersPerIp.get(ws.data.ip) ?? 1) - 1;
          if (remaining <= 0) viewersPerIp.delete(ws.data.ip);
          else viewersPerIp.set(ws.data.ip, remaining);
        }
        if (!stopping) settle();
      },
    },
  });

  log('listening', { host: server.hostname, port: server.port });

  return {
    port: server.port,
    async stop() {
      stopping = true;
      if (timer !== null) clearTimeout(timer);
      const pending = core.flushPersist();
      if (pending !== null) writeSnapshot(pending);
      for (const socket of [...viewers, ...(publisher === null ? [] : [publisher])]) socket.close(CLOSE_GOING_AWAY, 'server stopping');
      await server.stop(true);
      log('stopped');
    },
  };
}
