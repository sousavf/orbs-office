// Transport-independent relay logic, shared by the Cloudflare Durable Object (worker/) and the standalone Bun
// server (relay-server/). Pure TypeScript: no Workers or Bun APIs, time comes in through `now`.
//
// An adapter owns the sockets and feeds the core with events; the core answers with what to do (frames to send,
// a socket to close, a snapshot to persist, when to come back). It never touches a socket itself.

import { encodeRelayCountMessage, encodeWireMessage, parsePublisherMessage, parseWireMessage } from './public-snapshot';
import type { PublicSnapshot, WireMessage } from './public-snapshot';

/** Close code the page understands as "full": it moves to another relay, or shows delayed (polled) updates. */
export const BUSY_CLOSE_CODE = 4429;
/** Sent to a publisher that a newer authenticated publisher replaced. */
export const REPLACED_CLOSE_CODE = 4001;

export interface RelayLimits {
  /**
   * Hibernated sockets cost nothing while idle; the price of a larger cap is CPU per fan-out (about 4 snapshots/s of
   * 1-3 KB). 1000 keeps that to ~4k small sends/s.
   */
  maxViewers: number;
  maxViewersPerIp: number;
  /** Viewers never need to talk; a few stray frames are tolerated, a stream of them is not. */
  maxViewerMessages: number;
  maxViewerMessageBytes: number;
  maxConsecutiveInvalid: number;
  /** A valid frame is at most 64 KB of UTF-8, so longer strings are rejected before parsing. */
  maxPublishChars: number;
  publishWindowMs: number;
  /** The bridge sends at most about four snapshots a second plus a few events. */
  maxPublishPerWindow: number;
  /** A viewer-count frame (to viewers, and to the publisher) goes out at most this often. */
  countCoalesceMs: number;
  /** The newest snapshot is persisted at most this often; viewers get every frame regardless. */
  persistIntervalMs: number;
  /** A publisher-provided viewer total is shown only while it is this fresh. */
  providedTotalFreshMs: number;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxViewers: 1000,
  maxViewersPerIp: 5,
  maxViewerMessages: 10,
  maxViewerMessageBytes: 1024,
  maxConsecutiveInvalid: 20,
  maxPublishChars: 64 * 1024,
  publishWindowMs: 1_000,
  maxPublishPerWindow: 20,
  countCoalesceMs: 3_000,
  persistIntervalMs: 60_000,
  providedTotalFreshMs: 30_000,
};

const EMPTY_SNAPSHOT: PublicSnapshot = { v: 1, at: 0, bots: [] };

/** At most one send per interval for a value that changes; a changed value that must wait reports when to come back. */
export interface Coalescer {
  step(value: number, now: number): { send: boolean; dueAt: number | null };
  /** Forget what was sent, so the next step sends again. */
  reset(): void;
}

export function createCoalescer(intervalMs: number): Coalescer {
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastValue = -1;
  return {
    step(value, now) {
      if (value === lastValue) return { send: false, dueAt: null };
      const dueAt = lastAt + intervalMs;
      if (dueAt > now) return { send: false, dueAt };
      lastAt = now;
      lastValue = value;
      return { send: true, dueAt: null };
    },
    reset() {
      lastAt = Number.NEGATIVE_INFINITY;
      lastValue = -1;
    },
  };
}

export type RawFrame = string | { readonly byteLength: number };

export interface PublisherFrameResult {
  /** Encoded frame to send to every viewer unchanged, or null. */
  forward: string | null;
  /** Close the publisher's socket with this code. */
  close: { code: number; reason: string } | null;
  /** The frame was dropped because the publisher exceeded its frame budget. */
  rateLimited: boolean;
  /** Why a frame was rejected (a field path or limit, never a value), for the log. */
  invalid: { reason: string; total: number } | null;
}

export interface TickInput {
  /** Open viewer sockets on this relay. */
  localViewers: number;
  publisherConnected: boolean;
}

export interface TickResult {
  /** `viewers` frame for every viewer, or null. */
  viewersFrame: string | null;
  /** `count` frame for the publisher, or null. */
  countFrame: string | null;
  /** Encoded newest snapshot to write to storage now, or null. */
  persist: string | null;
  /** When to call `tick` again (epoch ms), or null when nothing is pending. */
  nextDueAt: number | null;
}

export interface ViewerMessageResult {
  close: boolean;
  /** The viewer's new message tally, to store with its socket. */
  messages: number;
}

export interface RelayCore {
  /** Loads a previously persisted snapshot frame; anything that does not validate is ignored. */
  restore(stored: string | null): void;
  /** Newest snapshot as a ready-to-send `snapshot` frame (the empty snapshot before the first one). */
  latestFrame(): string;
  /** Frames a new viewer gets first: the newest snapshot and the viewer count it should show. */
  hello(localViewers: number): string[];

  admitViewer(counts: { total: number; fromIp: number }): 'ok' | 'busy';
  /** The abuse rule for a frame a viewer sent: oversized or too many closes the socket. */
  onViewerMessage(size: number, messagesSoFar: number): ViewerMessageResult;

  /** One frame from the publisher. */
  onPublisherFrame(frame: RawFrame): PublisherFrameResult;
  /** A publisher socket was accepted; the relay reports its viewer count again. */
  onPublisherConnected(): void;
  /** The last publisher socket is gone; the provided total no longer applies. */
  onPublisherGone(): void;
  /** Writes of the newest snapshot must happen now (e.g. the publisher left). */
  flushPersist(): string | null;

  /** What viewers are shown: the publisher's cross-relay total while fresh, else this relay's own count. */
  displayedViewers(localViewers: number): number;
  /** Call after anything that can change a count or a due time (a viewer joined or left, a publisher frame, an alarm). */
  tick(input: TickInput): TickResult;

  stateBody(localViewers: number): string;
  snapshotBody(): string;
  viewersBody(localViewers: number): string;
}

export interface RelayCoreOptions {
  now: () => number;
  limits?: Partial<RelayLimits>;
}

export function createRelayCore(options: RelayCoreOptions): RelayCore {
  const limits: RelayLimits = { ...DEFAULT_RELAY_LIMITS, ...options.limits };
  const { now } = options;

  let latest: PublicSnapshot = EMPTY_SNAPSHOT;
  let latestFrame: string | null = null;
  let latestBots = JSON.stringify(EMPTY_SNAPSHOT.bots);
  let dirty = false;
  let lastPersistAt = Number.NEGATIVE_INFINITY;

  let invalidTotal = 0;
  let invalidStreak = 0;
  let publishWindowStart = Number.NEGATIVE_INFINITY;
  let publishWindowCount = 0;

  let provided: { n: number; at: number } | null = null;
  const viewerCoalescer = createCoalescer(limits.countCoalesceMs);
  const reportCoalescer = createCoalescer(limits.countCoalesceMs);

  const frameText = (message: WireMessage): string | null => {
    const encoded = encodeWireMessage(message);
    return encoded.ok ? encoded.value : null;
  };

  const emptyFrame = (): string => JSON.stringify({ t: 'snapshot', snapshot: EMPTY_SNAPSHOT } satisfies WireMessage);

  const displayed = (local: number, at: number): number => {
    if (provided !== null && at - provided.at < limits.providedTotalFreshMs) return provided.n;
    return local;
  };

  const withinPublishBudget = (at: number): boolean => {
    if (at - publishWindowStart >= limits.publishWindowMs) {
      publishWindowStart = at;
      publishWindowCount = 0;
    }
    publishWindowCount += 1;
    return publishWindowCount <= limits.maxPublishPerWindow;
  };

  /** Keepalive snapshots repeat the same bots; only a change is worth keeping and persisting. */
  const remember = (snapshot: PublicSnapshot, encoded: string): void => {
    const bots = JSON.stringify(snapshot.bots);
    if (bots === latestBots) return;
    latest = snapshot;
    latestFrame = encoded;
    latestBots = bots;
    dirty = true;
  };

  const takePersist = (at: number): string | null => {
    if (!dirty || latestFrame === null) return null;
    dirty = false;
    lastPersistAt = at;
    return latestFrame;
  };

  return {
    restore(stored) {
      if (stored === null) return;
      const parsed = parseWireMessage(stored);
      if (!parsed.ok || parsed.value.t !== 'snapshot') return;
      const encoded = frameText(parsed.value);
      if (encoded === null) return;
      latest = parsed.value.snapshot;
      latestFrame = encoded;
      latestBots = JSON.stringify(latest.bots);
    },

    latestFrame: () => latestFrame ?? emptyFrame(),

    hello(localViewers) {
      const count = frameText({ t: 'viewers', n: displayed(localViewers, now()) });
      return [latestFrame ?? emptyFrame(), ...(count === null ? [] : [count])];
    },

    admitViewer({ total, fromIp }) {
      return total >= limits.maxViewers || fromIp >= limits.maxViewersPerIp ? 'busy' : 'ok';
    },

    onViewerMessage(size, messagesSoFar) {
      const messages = messagesSoFar + 1;
      return { close: size > limits.maxViewerMessageBytes || messages > limits.maxViewerMessages, messages };
    },

    onPublisherFrame(frame) {
      const at = now();
      if (!withinPublishBudget(at)) return { forward: null, close: null, invalid: null, rateLimited: true };
      const parsed =
        typeof frame !== 'string'
          ? ({ ok: false, error: 'binary frame' } as const)
          : frame.length > limits.maxPublishChars
            ? ({ ok: false, error: 'frame too large' } as const)
            : parsePublisherMessage(frame);
      const encoded = parsed.ok ? encodeWireMessage(parsed.value) : parsed;
      if (!parsed.ok || !encoded.ok) {
        invalidTotal += 1;
        invalidStreak += 1;
        const reason = parsed.ok ? (encoded.ok ? '' : encoded.error) : parsed.error;
        const close =
          invalidStreak >= limits.maxConsecutiveInvalid ? { code: 1008, reason: 'too many invalid messages' } : null;
        return { forward: null, close, invalid: { reason, total: invalidTotal }, rateLimited: false };
      }
      invalidStreak = 0;
      const message = parsed.value;
      if (message.t === 'viewers') {
        provided = { n: message.n, at };
        return { forward: null, close: null, invalid: null, rateLimited: false };
      }
      if (message.t === 'snapshot') remember(message.snapshot, encoded.value);
      return { forward: encoded.value, close: null, invalid: null, rateLimited: false };
    },

    onPublisherConnected() {
      reportCoalescer.reset();
    },

    onPublisherGone() {
      provided = null;
    },

    flushPersist: () => takePersist(now()),

    displayedViewers: (localViewers) => displayed(localViewers, now()),

    tick({ localViewers, publisherConnected }) {
      const at = now();
      const dues: number[] = [];
      if (provided !== null && at - provided.at >= limits.providedTotalFreshMs) provided = null;
      if (provided !== null) dues.push(provided.at + limits.providedTotalFreshMs);

      const shown = viewerCoalescer.step(displayed(localViewers, at), at);
      if (shown.dueAt !== null) dues.push(shown.dueAt);
      const viewersFrame = shown.send ? frameText({ t: 'viewers', n: displayed(localViewers, at) }) : null;

      let countFrame: string | null = null;
      if (publisherConnected) {
        const report = reportCoalescer.step(localViewers, at);
        if (report.dueAt !== null) dues.push(report.dueAt);
        if (report.send) {
          const encoded = encodeRelayCountMessage(localViewers);
          countFrame = encoded.ok ? encoded.value : null;
        }
      }

      let persist: string | null = null;
      if (dirty) {
        const due = lastPersistAt + limits.persistIntervalMs;
        if (due <= at) persist = takePersist(at);
        else dues.push(due);
      }
      return { viewersFrame, countFrame, persist, nextDueAt: dues.length === 0 ? null : Math.min(...dues) };
    },

    stateBody: (localViewers) => JSON.stringify({ snapshot: latest, viewers: displayed(localViewers, now()) }),
    snapshotBody: () => JSON.stringify(latest),
    viewersBody: (localViewers) => JSON.stringify({ n: displayed(localViewers, now()) }),
  };
}
