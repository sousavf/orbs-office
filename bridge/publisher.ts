// Outbound-only WebSocket client for one relay: reconnects with backoff, heartbeats. Each relay gets its own instance,
// so reconnects and heartbeats are independent and the log lines name the relay.

import { encodeWireMessage } from '../shared/public-snapshot';
import type { RelayLink } from './fanout';

const HEARTBEAT_MS = 20_000;
/** How long a ping may stay unanswered before the connection is treated as dead. */
const PONG_TIMEOUT_MS = 30_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** Bun's WebSocket accepts request headers as a second argument; the DOM type does not know that. */
type HeaderWebSocket = new (url: string, options: { headers: Record<string, string> }) => WebSocket;
const AuthWebSocket = WebSocket as unknown as HeaderWebSocket;

export interface Publisher extends RelayLink {
  /** Called on every (re)connect so the caller can send a full snapshot. */
  onConnect: (() => void) | null;
  /** Called when an established connection ends. */
  onDisconnect: (() => void) | null;
}

export function createPublisher(name: string, relayUrl: string, token: string, logLine: (line: string) => void): Publisher {
  const log = (line: string): void => logLine(`[${name}] ${line}`);
  let socket: WebSocket | null = null;
  let backoff = BACKOFF_START_MS;
  let stopped = false;
  /** When the oldest unanswered ping was sent; null when none is outstanding. */
  let pingSentAt: number | null = null;
  let lastTick = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let lastCloseCode: number | null = null;

  const publisher: Publisher = {
    name,
    onConnect: null,
    onDisconnect: null,
    onMessage: null,
    get isConnected() {
      return socket !== null && socket.readyState === WebSocket.OPEN;
    },
    send(message) {
      if (socket === null || socket.readyState !== WebSocket.OPEN) return;
      const encoded = encodeWireMessage(message);
      if (!encoded.ok) {
        log(`dropped outgoing message: ${encoded.error}`);
        return;
      }
      socket.send(encoded.value);
    },
    stop() {
      stopped = true;
      if (heartbeat !== null) clearInterval(heartbeat);
      if (retry !== null) clearTimeout(retry);
      socket?.close(1000, 'bridge stopping');
    },
  };

  function scheduleReconnect(): void {
    if (stopped || retry !== null) return;
    const delay = backoff / 2 + Math.random() * (backoff / 2);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    log(`relay disconnected${lastCloseCode === null ? '' : ` (code ${lastCloseCode})`}; retrying in ${Math.round(delay / 1000)}s`);
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (stopped) return;
    const next = new AuthWebSocket(relayUrl, { headers: { Authorization: `Bearer ${token}` } });
    socket = next;
    next.addEventListener('open', () => {
      backoff = BACKOFF_START_MS;
      pingSentAt = null;
      log('connected to relay');
      publisher.onConnect?.();
    });
    next.addEventListener('message', (event: MessageEvent<unknown>) => {
      pingSentAt = null;
      if (typeof event.data === 'string' && event.data !== 'pong') publisher.onMessage?.(event.data);
    });
    next.addEventListener('close', (event) => {
      const wasCurrent = socket === next;
      if (wasCurrent) socket = null;
      lastCloseCode = event.code;
      pingSentAt = null;
      if (wasCurrent) publisher.onDisconnect?.();
      if (event.code === 1008) log('relay refused the publish token or another publisher is connected');
      scheduleReconnect();
    });
    next.addEventListener('error', () => {
      // A close event always follows; reconnect is handled there.
    });
  }

  heartbeat = setInterval(() => {
    const now = Date.now();
    // Timers stall while the Mac sleeps; after such a gap an old ping says nothing about the link, so start over.
    const resumed = now - lastTick > HEARTBEAT_MS * 2;
    lastTick = now;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    if (resumed) pingSentAt = null;
    if (pingSentAt !== null && now - pingSentAt > PONG_TIMEOUT_MS) {
      log(`relay heartbeat timed out after ${Math.round((now - pingSentAt) / 1000)}s; reconnecting`);
      socket.close(4000, 'heartbeat timeout');
      return;
    }
    pingSentAt ??= now;
    socket.send('ping');
  }, HEARTBEAT_MS);

  connect();
  return publisher;
}
