import { parseWireMessage, validatePublicSnapshot, validateViewerCount } from '../../shared/public-snapshot';
import type { PublicActivity, PublicBot, PublicSnapshot } from '../../shared/public-snapshot';
import { parseRelayList, resolveEndpoints } from '../../shared/relay-endpoints';
import type { ResolvedEndpoint } from '../../shared/relay-endpoints';
import type { BotActivity, BotState, OfficeEvent, OfficeFeed, OfficeState, SubagentState } from '../feed/office.types';
import type { FigureSource, IslandSource } from '../office-contracts';
import { FakeRoutines } from './fiction';
import { loremSentence } from './lorem';
import { PublicPrefs } from './public-prefs';

/** `live`: frames are arriving; `paused`: none for a while (last state kept); `connecting`: nothing yet. */
export type FeedStatus = 'connecting' | 'live' | 'paused';

export interface PublicFeed extends OfficeFeed {
  /** Figure and island per bot, read from the snapshots. */
  readonly figures: FigureSource;
  readonly islands: IslandSource;
  onStatus(listener: (status: FeedStatus) => void): () => void;
  /** Number of people watching, as counted by the relay; null until known. Kept apart from the scene's state. */
  /** True while the relay is full and the page shows polled (delayed) updates. */
  onBusy(listener: (busy: boolean) => void): () => void;
  onViewers(listener: (count: number | null) => void): () => void;
  start(): void;
  stop(): void;
}

const STALE_AFTER_MS = 90_000;
const STALE_CHECK_MS = 5_000;
/** Polling is the fallback, so it stays cheap: the relay shares the answer at the edge for a few seconds anyway. */
const POLL_MS = 30_000;
/** The relay closes with this code when it is full; the page then polls and retries the socket slowly. */
const BUSY_CLOSE_CODE = 4429;
const BUSY_RETRY_MS = 60_000;
const BUSY_RETRY_MAX_MS = 300_000;
const PING_MS = 25_000;
/** Phones drop idle sockets silently; no reply this soon after a ping means the socket is dead. */
const PONG_TIMEOUT_MS = 10_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const POLL_TIMEOUT_MS = 8_000;
/** Failed socket attempts in a row (at least one full pass over the endpoints) before the page also polls `/state.json`. */
const POLL_AFTER_FAILURES = 2;
/** A socket that has not opened by now is abandoned and the next endpoint is tried. */
const CONNECT_TIMEOUT_MS = 5_000;
/** Moves that are not forced by a failure (back to a higher priority, or away from a silent relay) wait at least this long since the last move. */
const MIN_SWITCH_INTERVAL_MS = 20_000;
/** While on a lower-priority endpoint, the higher ones are probed this often (jittered). */
const PROBE_MIN_MS = 60_000;
const PROBE_MAX_MS = 120_000;
const PROBE_TIMEOUT_MS = 5_000;
/** A failure-driven move to the next endpoint is spread over this long, so a relay outage does not stampede the backup. */
const FAILOVER_JITTER_MS = 1_500;
const FICTION_REFRESH_MS = 30_000;

function toActivity(activity: PublicActivity): BotActivity {
  switch (activity.kind) {
    case 'idle':
    case 'thinking':
      return { kind: activity.kind };
    case 'tool':
      return { kind: 'tool', tool: '', family: activity.family };
    case 'waiting':
      return { kind: 'waiting', approvalCount: 0 };
    case 'meeting':
      return { kind: 'meeting', withBotIds: activity.with };
  }
}

/** Helpers carry the parent's activity so they look busy; nothing else about them is known. */
function toSubagents(bot: PublicBot, activity: BotActivity): SubagentState[] {
  const shown: BotActivity = activity.kind === 'tool' ? activity : { kind: 'thinking' };
  return Array.from({ length: bot.subagents }, (_, index) => ({ id: `${bot.id}-${index}`, name: null, activity: shown }));
}

function toBotState(bot: PublicBot, receivedAt: number): BotState {
  const activity = toActivity(bot.activity);
  return {
    id: bot.id,
    name: bot.name,
    handle: '',
    avatar: null,
    color: bot.color,
    rank: bot.rank,
    activity,
    run:
      bot.runStartedAgoSec === null
        ? null
        : {
            id: '',
            trigger: 'other',
            title: null,
            startedAt: receivedAt - bot.runStartedAgoSec * 1000,
            toolCallCount: 0,
            tokens: 0,
            isFailed: false,
          },
    subagents: toSubagents(bot, activity),
    nextRoutine: null,
    lastMessage: null,
  };
}

/** The endpoint list from public.html's `office-relays` meta, in priority order; without it, only the page's own host. */
function readEndpoints(): ResolvedEndpoint[] {
  const content = document.querySelector('meta[name="office-relays"]')?.getAttribute('content');
  const parsed = parseRelayList(content);
  return resolveEndpoints(parsed.ok ? parsed.value : [{ kind: 'self' }], window.location.origin);
}

/**
 * The public page's data source: the relay's allow-listed snapshots, mapped to the scene's state.
 * Every frame goes through the shared validator and invalid ones are dropped. The text of replies and
 * the routines on the mailroom board are random placeholders made here, never real data.
 */
export function createPublicFeed(endpoints: readonly ResolvedEndpoint[] = readEndpoints()): PublicFeed {
  const prefs = new PublicPrefs();
  const fiction = new FakeRoutines();
  const listeners = new Set<(event: OfficeEvent) => void>();
  const statusListeners = new Set<(status: FeedStatus) => void>();
  let state: OfficeState = { connection: { kind: 'connecting' }, bots: new Map() };
  let status: FeedStatus = 'connecting';
  const viewerListeners = new Set<(count: number | null) => void>();
  let viewers: number | null = null;
  const busyListeners = new Set<(busy: boolean) => void>();
  let busy = false;
  let busyBackoff = BUSY_RETRY_MS;
  let snapshot: PublicSnapshot | null = null;
  let snapshotKey = '';
  let receivedAt = 0;
  let lastFrameAt = 0;
  let newestSnapshotAt = 0;

  let socket: WebSocket | null = null;
  let running = false;
  /** Index into `endpoints` of the relay in use (0 is the highest priority). */
  let index = 0;
  /** Failed socket attempts since a relay last delivered a frame; busy refusals are counted separately. */
  let attempts = 0;
  let busyAttempts = 0;
  let lastSwitchAt = 0;
  /** Silent-relay moves since the last frame: capped at one pass, because every relay is silent when the publisher is gone. */
  let staleSwitches = 0;
  let socketOpen = false;
  let backoff = BACKOFF_START_MS;
  let reconnectTimer: number | undefined;
  let connectTimer: number | undefined;
  let probeTimer: number | undefined;
  let pingTimer: number | undefined;
  let pongTimer: number | undefined;
  let pollTimer: number | undefined;
  let staleTimer: number | undefined;
  let fictionTimer: number | undefined;
  let polling = false;

  const emit = (event: OfficeEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const setStatus = (next: FeedStatus): void => {
    if (next === status) return;
    status = next;
    for (const listener of [...statusListeners]) listener(next);
  };

  const setBusy = (next: boolean): void => {
    if (next === busy) return;
    busy = next;
    for (const listener of [...busyListeners]) listener(next);
  };

  const setViewers = (next: number): void => {
    if (next === viewers) return;
    viewers = next;
    for (const listener of [...viewerListeners]) listener(next);
  };

  const publish = (): void => {
    if (snapshot === null) return;
    const bots = new Map<string, BotState>();
    for (const bot of snapshot.bots) bots.set(bot.id, toBotState(bot, receivedAt));
    const ordered = [...bots.values()].sort((a, b) => a.rank - b.rank);
    fiction.list.forEach((routine, index) => {
      const bot = ordered[index];
      if (bot !== undefined) bots.set(bot.id, { ...bot, nextRoutine: { name: routine.name, at: routine.at } });
    });
    state = { connection: { kind: 'connected', serverUrl: '' }, bots };
    emit({ kind: 'state', state });
  };

  const noteFrame = (): void => {
    lastFrameAt = Date.now();
    staleSwitches = 0;
    setStatus('live');
  };

  const ingest = (next: PublicSnapshot): void => {
    // A relay hands every new viewer its stored snapshot. That is not news: only a snapshot newer than any seen counts as a
    // sign of life, so switching relays cannot make a dead feed look live again.
    if (next.at > newestSnapshotAt) {
      newestSnapshotAt = next.at;
      noteFrame();
    }
    const key = JSON.stringify(next.bots);
    if (key === snapshotKey && snapshot !== null) return;
    snapshotKey = key;
    snapshot = next;
    receivedAt = Date.now();
    fiction.refresh(receivedAt);
    // Figures and islands first, so the scene reads the new values when it handles the state.
    prefs.update(next.bots);
    publish();
  };

  const onFrame = (data: unknown): void => {
    if (typeof data !== 'string') return;
    const parsed = parseWireMessage(data);
    if (!parsed.ok) return;
    if (parsed.value.t === 'snapshot') {
      ingest(parsed.value.snapshot);
      return;
    }
    // The relay sends this itself, so it says nothing about whether the publisher is alive.
    if (parsed.value.t === 'viewers') {
      setViewers(parsed.value.n);
      return;
    }
    noteFrame();
    const { kind, bot } = parsed.value.event;
    if (kind === 'mail') emit({ kind: 'mail', botId: bot, trigger: 'message' });
    else if (kind === 'failed') emit({ kind: 'failed', botId: bot });
    else emit({ kind: 'reply', botId: bot, text: loremSentence() });
  };

  /** One `/state.json` read from one endpoint; true when it produced a valid snapshot. */
  const pollEndpoint = async (endpoint: ResolvedEndpoint): Promise<boolean> => {
    const response = await fetch(`${endpoint.httpBase}/state.json`, { cache: 'no-store', signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return false;
    const { snapshot: rawSnapshot, viewers: rawViewers } = body as { snapshot?: unknown; viewers?: unknown };
    const count = validateViewerCount(rawViewers);
    if (count.ok) setViewers(count.value);
    const checked = validatePublicSnapshot(rawSnapshot);
    if (!checked.ok) return false;
    ingest(checked.value);
    return true;
  };

  /** Polls the selected endpoint first, then the others in priority order, until one answers. */
  const poll = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    try {
      for (let offset = 0; offset < endpoints.length; offset += 1) {
        const endpoint = endpoints[(index + offset) % endpoints.length];
        try {
          if (endpoint !== undefined && (await pollEndpoint(endpoint))) return;
        } catch {
          // Offline or a bad body: try the next endpoint; the stale check reports the gap.
        }
      }
    } finally {
      polling = false;
    }
  };

  const startPolling = (): void => {
    if (pollTimer !== undefined) return;
    void poll();
    // Self-rescheduling with jitter, so many viewers that started together do not poll in step.
    const tick = (): void => {
      pollTimer = window.setTimeout(() => {
        void poll();
        tick();
      }, POLL_MS * (0.75 + Math.random() * 0.5));
    };
    tick();
  };

  const stopPolling = (): void => {
    if (pollTimer === undefined) return;
    window.clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const stopSocketTimers = (): void => {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    window.clearTimeout(connectTimer);
    connectTimer = undefined;
    window.clearInterval(pingTimer);
    pingTimer = undefined;
    window.clearTimeout(pongTimer);
    pongTimer = undefined;
  };

  const stopProbe = (): void => {
    window.clearTimeout(probeTimer);
    probeTimer = undefined;
  };

  /** Only a failure of the relay in use may trigger this: it opens the next attempt after `delay`. */
  const scheduleConnect = (delay: number): void => {
    if (!running || reconnectTimer !== undefined) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  /** Probes the higher-priority endpoints with a cheap `GET /healthz`. */
  const isHealthy = async (endpoint: ResolvedEndpoint): Promise<boolean> => {
    try {
      const response = await fetch(`${endpoint.httpBase}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return response.ok;
    } catch {
      return false;
    }
  };

  const select = (next: number): void => {
    if (next === index) return;
    index = next;
    lastSwitchAt = Date.now();
    document.documentElement.dataset.relay = String(index);
    scheduleProbe();
  };

  /** Leaves the current relay on purpose (the socket was fine or silent): closes it and connects to `next` at once. */
  const switchTo = (next: number): void => {
    stopSocketTimers();
    const old = socket;
    socket = null;
    socketOpen = false;
    old?.close(1000, 'switching');
    select(next);
    attempts = 0;
    busyAttempts = 0;
    connect();
  };

  function scheduleProbe(): void {
    stopProbe();
    if (!running || index === 0 || endpoints.length < 2) return;
    probeTimer = window.setTimeout(() => {
      probeTimer = undefined;
      void probe();
    }, PROBE_MIN_MS + Math.random() * (PROBE_MAX_MS - PROBE_MIN_MS));
  }

  /** While on a lower-priority relay, goes back to the first higher-priority one that answers (never faster than once per 20 s). */
  async function probe(): Promise<void> {
    if (!running || document.hidden || index === 0) return;
    for (let candidate = 0; candidate < index; candidate += 1) {
      const endpoint = endpoints[candidate];
      if (endpoint === undefined || !(await isHealthy(endpoint))) continue;
      if (running && candidate < index && Date.now() - lastSwitchAt >= MIN_SWITCH_INTERVAL_MS) {
        switchTo(candidate);
        return;
      }
      break;
    }
    scheduleProbe();
  }

  /**
   * The socket in use ended: closed by the relay, refused as busy, never opened, or stopped answering pings.
   * Moves on to the next endpoint at once; after a full pass without success it backs off and starts polling.
   */
  const endAttempt = (ws: WebSocket, code: number | null, hadFrames: boolean): void => {
    if (socket !== ws) return;
    socket = null;
    socketOpen = false;
    stopSocketTimers();
    try {
      ws.close();
    } catch {
      // Already closed.
    }
    if (hadFrames) {
      attempts = 0;
      busyAttempts = 0;
    }
    attempts += 1;
    if (code === BUSY_CLOSE_CODE) busyAttempts += 1;
    const count = endpoints.length;
    select((index + 1) % count);
    if (attempts % count !== 0) {
      scheduleConnect(Math.random() * FAILOVER_JITTER_MS);
      return;
    }
    // A full pass failed. Everything was full: say so and retry slowly; otherwise ordinary backoff.
    let delay: number;
    if (busyAttempts === attempts) {
      setBusy(true);
      startPolling();
      delay = busyBackoff * (1 + Math.random());
      busyBackoff = Math.min(busyBackoff * 2, BUSY_RETRY_MAX_MS);
    } else {
      // Full jitter: after a relay redeploy every client drops at once, and this spreads their return over the window.
      delay = Math.max(BACKOFF_START_MS, Math.random() * backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
    if (attempts >= Math.max(POLL_AFTER_FAILURES, count)) startPolling();
    scheduleConnect(delay);
  };

  function connect(): void {
    if (!running || socket !== null) return;
    const endpoint = endpoints[index];
    if (endpoint === undefined) return;
    let hadFrames = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint.liveUrl);
    } catch {
      attempts += 1;
      select((index + 1) % endpoints.length);
      if (attempts >= Math.max(POLL_AFTER_FAILURES, endpoints.length)) startPolling();
      scheduleConnect(Math.max(BACKOFF_START_MS, Math.random() * backoff));
      return;
    }
    socket = ws;
    connectTimer = window.setTimeout(() => {
      connectTimer = undefined;
      if (!socketOpen) endAttempt(ws, null, false);
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      socketOpen = true;
      window.clearTimeout(connectTimer);
      connectTimer = undefined;
      pingTimer = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send('ping');
        window.clearTimeout(pongTimer);
        pongTimer = window.setTimeout(() => endAttempt(ws, null, hadFrames), PONG_TIMEOUT_MS);
      }, PING_MS);
    });
    ws.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (socket !== ws) return;
      if (!hadFrames) {
        hadFrames = true;
        attempts = 0;
        busyAttempts = 0;
        backoff = BACKOFF_START_MS;
        busyBackoff = BUSY_RETRY_MS;
        setBusy(false);
        stopPolling();
      }
      window.clearTimeout(pongTimer);
      pongTimer = undefined;
      onFrame(event.data);
    });
    ws.addEventListener('close', (event) => endAttempt(ws, event.code, hadFrames));
    // 'error' is always followed by 'close', which does the handling.
    ws.addEventListener('error', () => {});
  }

  const onVisibility = (): void => {
    if (document.hidden) {
      // A hidden tab renders nothing, so it should not hold one of the relay's limited viewer slots.
      stopSocketTimers();
      stopPolling();
      stopProbe();
      const old = socket;
      socket = null;
      socketOpen = false;
      old?.close(1000, 'hidden');
    } else if (running) {
      backoff = BACKOFF_START_MS;
      // Back from hidden: start again from the highest priority.
      attempts = 0;
      busyAttempts = 0;
      select(0);
      connect();
      // Refresh at once instead of waiting for the socket's first frame (or the next poll).
      void poll();
    }
  };

  return {
    figures: prefs.figures,
    islands: prefs.islands,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener({ kind: 'state', state });
      return () => listeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    onBusy(listener) {
      busyListeners.add(listener);
      listener(busy);
      return () => busyListeners.delete(listener);
    },
    onViewers(listener) {
      viewerListeners.add(listener);
      listener(viewers);
      return () => viewerListeners.delete(listener);
    },
    start() {
      if (running) return;
      running = true;
      lastFrameAt = Date.now();
      document.documentElement.dataset.relay = String(index);
      document.addEventListener('visibilitychange', onVisibility);
      staleTimer = window.setInterval(() => {
        // A hidden tab is not connected on purpose; it must not report a paused feed on return.
        if (document.hidden) {
          lastFrameAt = Date.now();
          return;
        }
        const now = Date.now();
        if (snapshot !== null && now - lastFrameAt > STALE_AFTER_MS) setStatus('paused');
        // Connected but silent for too long: try the next relay (once around only: with the publisher gone, all are silent).
        const silentSince = Math.max(lastFrameAt, lastSwitchAt);
        if (
          socketOpen &&
          endpoints.length > 1 &&
          staleSwitches < endpoints.length - 1 &&
          now - silentSince > STALE_AFTER_MS &&
          now - lastSwitchAt >= MIN_SWITCH_INTERVAL_MS
        ) {
          staleSwitches += 1;
          switchTo((index + 1) % endpoints.length);
        }
      }, STALE_CHECK_MS);
      fictionTimer = window.setInterval(() => {
        if (fiction.refresh(Date.now())) publish();
      }, FICTION_REFRESH_MS);
      if (!document.hidden) connect();
    },
    stop() {
      running = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(staleTimer);
      window.clearInterval(fictionTimer);
      stopSocketTimers();
      stopPolling();
      stopProbe();
      const old = socket;
      socket = null;
      socketOpen = false;
      old?.close(1000, 'stopped');
    },
  };
}
