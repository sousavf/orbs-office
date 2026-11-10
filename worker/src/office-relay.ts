import { DurableObject } from 'cloudflare:workers';
import { BUSY_CLOSE_CODE, REPLACED_CLOSE_CODE, createRelayCore } from '../../shared/relay-core';
import { CLIENT_IP_HEADER } from './constants';

const SNAPSHOT_KEY = 'snapshot';

type Role = 'viewer' | 'publisher';
interface Attachment {
  role: Role;
  ip: string;
  messages: number;
}

function readAttachment(socket: WebSocket): Attachment | null {
  const raw: unknown = socket.deserializeAttachment();
  if (typeof raw !== 'object' || raw === null) return null;
  const { role, ip, messages } = raw as Record<string, unknown>;
  if ((role !== 'viewer' && role !== 'publisher') || typeof ip !== 'string' || typeof messages !== 'number') return null;
  return { role, ip, messages };
}

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } as const;

/**
 * The Cloudflare relay: a thin adapter over the shared relay core (shared/relay-core.ts). It owns the hibernating
 * sockets, the storage and the alarm; every decision (limits, validation, counts, persistence timing) is the core's.
 */
export class OfficeRelay extends DurableObject<Env> {
  private readonly core = createRelayCore({ now: Date.now });
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object: the publisher's heartbeat and viewer keepalives.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.core.restore((await this.ctx.storage.get<string>(SNAPSHOT_KEY)) ?? null);
    this.loaded = true;
  }

  /** Open viewer sockets; one that is mid-close no longer counts. */
  private openViewers(): WebSocket[] {
    return this.ctx.getWebSockets('viewer').filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private openPublisher(except?: WebSocket): WebSocket | undefined {
    return this.ctx.getWebSockets('publisher').find((socket) => socket !== except && socket.readyState === WebSocket.OPEN);
  }

  private broadcast(frame: string): void {
    for (const viewer of this.openViewers()) {
      try {
        viewer.send(frame);
      } catch {
        // Viewer is going away; its close handler cleans up.
      }
    }
  }

  /** One alarm serves every pending duty (count frames, snapshot write, staleness of the provided total): the earliest wins. */
  private async armAlarm(dueAt: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || dueAt < existing) await this.ctx.storage.setAlarm(Math.max(dueAt, Date.now() + 1));
  }

  /** Asks the core what is due and does it. Called after anything that can change a count or a deadline. */
  private async settle(): Promise<void> {
    await this.load();
    const publisher = this.openPublisher();
    const result = this.core.tick({ localViewers: this.openViewers().length, publisherConnected: publisher !== undefined });
    if (result.viewersFrame !== null) this.broadcast(result.viewersFrame);
    if (result.countFrame !== null) {
      try {
        publisher?.send(result.countFrame);
      } catch {
        // Publisher is going away; its close handler cleans up.
      }
    }
    if (result.persist !== null) await this.ctx.storage.put(SNAPSHOT_KEY, result.persist);
    if (result.nextDueAt !== null) await this.armAlarm(result.nextDueAt);
  }

  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const headOnly = request.method === 'HEAD';
    if (pathname === '/viewers.json') {
      return new Response(headOnly ? null : this.core.viewersBody(this.openViewers().length), { headers: NO_STORE });
    }
    if (pathname === '/state.json') {
      await this.load();
      return new Response(headOnly ? null : this.core.stateBody(this.openViewers().length), { headers: NO_STORE });
    }
    if (pathname === '/snapshot.json') {
      await this.load();
      return new Response(headOnly ? null : this.core.snapshotBody(), { headers: NO_STORE });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (pathname === '/publish') return this.acceptPublisher();
    if (pathname === '/live') return this.acceptViewer(request.headers.get(CLIENT_IP_HEADER) ?? 'unknown');
    return new Response(null, { status: 404 });
  }

  override async alarm(): Promise<void> {
    await this.settle();
  }

  private acceptPublisher(): Response {
    // The newest authenticated publisher wins: a dead half-open connection must never lock the real one out.
    for (const old of this.ctx.getWebSockets('publisher')) old.close(REPLACED_CLOSE_CODE, 'replaced by a newer publisher');
    this.core.onPublisherConnected();
    const { response } = this.accept('publisher', 'publisher');
    this.ctx.waitUntil(this.settle());
    return response;
  }

  private acceptViewer(ip: string): Response {
    const viewers = this.ctx.getWebSockets('viewer');
    const fromIp = viewers.filter((socket) => readAttachment(socket)?.ip === ip).length;
    if (this.core.admitViewer({ total: viewers.length, fromIp }) === 'busy') return this.refuse();
    const { response, server } = this.accept('viewer', ip);
    // Sent asynchronously so the upgrade response is not delayed by the storage read.
    this.ctx.waitUntil(this.welcome(server));
    this.ctx.waitUntil(this.settle());
    return response;
  }

  /** Completes the upgrade and closes at once with a code the page can read (an HTTP error would hide the reason from scripts). */
  private refuse(): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    server.close(BUSY_CLOSE_CODE, 'busy');
    return new Response(null, { status: 101, webSocket: client });
  }

  private accept(role: Role, ip: string): { response: Response; server: WebSocket } {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, ip, messages: 0 } satisfies Attachment);
    return { response: new Response(null, { status: 101, webSocket: client }), server };
  }

  private async welcome(socket: WebSocket): Promise<void> {
    await this.load();
    try {
      for (const frame of this.core.hello(this.openViewers().length)) socket.send(frame);
    } catch {
      // Socket closed before the first message: nothing to do.
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.load();
    const attachment = readAttachment(ws);
    if (attachment?.role === 'publisher') {
      const result = this.core.onPublisherFrame(message);
      if (result.invalid !== null) {
        // The reason names a field path or limit, never a value.
        console.warn(JSON.stringify({ event: 'invalid_publish', reason: result.invalid.reason, total: result.invalid.total }));
      }
      if (result.close !== null) ws.close(result.close.code, result.close.reason);
      if (result.forward !== null) this.broadcast(result.forward);
      await this.settle();
      return;
    }
    // Viewers are read-only: anything they send is ignored, and a stream of it closes the socket.
    const size = typeof message === 'string' ? message.length : message.byteLength;
    const verdict = this.core.onViewerMessage(size, attachment?.messages ?? 0);
    if (verdict.close) {
      ws.close(1008, 'read-only endpoint');
      return;
    }
    if (attachment !== null) ws.serializeAttachment({ ...attachment, messages: verdict.messages } satisfies Attachment);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.load();
    if (readAttachment(ws)?.role === 'publisher' && this.openPublisher(ws) === undefined) {
      this.core.onPublisherGone();
      const pending = this.core.flushPersist();
      if (pending !== null) await this.ctx.storage.put(SNAPSHOT_KEY, pending);
    }
    // A close code of 1005/1006 cannot be echoed back, so always complete with a normal close.
    try {
      ws.close(1000, 'closing');
    } catch {
      // Already closed.
    }
    await this.settle();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
    await this.settle();
  }
}
