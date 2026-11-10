import { assertValidOp, applyImmutable } from '@earendil-works/chord/delta';
import type { Op } from '@earendil-works/chord/delta';
import { browserGrantStorage } from '../connection/connection-storage';
import type { GrantStorage, StoredGrant } from '../connection/connection-storage';
import { errorCode, makeOrbsClient, normalizeDaemonUrl, redeemPairing } from '../orbs/orbs-client';
import type {
  ActivityRun,
  ConversationListItem,
  ConversationListState,
  OrbsClient,
  Routine,
} from '../orbs/orbs.types';
import type {
  BotState,
  ConnectionStatus,
  OfficeEvent,
  OfficeFeedControl,
  OfficeState,
} from './office.types';
import {
  activityFromSpan,
  busyFallback,
  chatLinesFrom,
  botColor,
  fatalMessage,
  mainSpan,
  nextRoutine,
  pairMeetings,
  subagentsOf,
  toolFamily,
} from './office-feed.utils';
import type { MeetingCandidate } from './office-feed.utils';

const POLL_INTERVAL_MS = 1_500;
const ROUTINE_INTERVAL_MS = 60_000;
const CALL_TIMEOUT_MS = 10_000;
const EMIT_DELAY_MS = 50;
const RECONNECT_DELAY_MS = 2_000;
const MAX_INITIAL_FAILURES = 3;
const PEER_PARTNER_TTL_MS = 10 * 60_000;
const HISTORY_LIMIT = 30;
/** The daemon's maximum page size for `conversation.contexts`. */
const PRIVATE_CONTEXT_LIMIT = 100;
/** The daemon's limit for one message (`conversationSubmit.content`). */
const MAX_MESSAGE_LENGTH = 64_000;

/** User-facing failure while sending a message; `message` is safe to show as-is. */
export class SendError extends Error {
  override readonly name = 'SendError';
}

function sendFailureMessage(code: string | null): string {
  if (code === 'CONFLICT') return 'The bot is busy and did not accept the message. Try again in a moment.';
  if (code === 'NOT_FOUND') return 'This bot no longer exists.';
  if (code === 'VALIDATION_ERROR') return 'Orbs rejected the message.';
  return 'Could not send the message. Check the connection to Orbs.';
}

interface BotDetail {
  run: ActivityRun | null;
  approvals: number;
  /** Bots with a running private conversation this bot opened; fetched only while it is messaging. */
  peers: readonly string[];
}

/** Everything that belongs to one connection attempt; aborting `signal` stops all of it. */
interface Session {
  controller: AbortController;
  client: OrbsClient;
  close: () => void;
  grant: StoredGrant;
  conversations: ConversationListItem[];
  details: Map<string, BotDetail>;
  routines: Map<string, Routine[]>;
  pollers: Set<string>;
  lastEntry: Map<string, number>;
  failedRuns: Set<string>;
  /** Who each bot last talked to, so a peer reply (which does not name its sender) rejoins the same meeting. */
  peerPartners: Map<string, { botId: string; at: number }>;
  isFirstSnapshot: boolean;
  routineTimer: ReturnType<typeof setInterval> | null;
}

function toOps(frame: readonly unknown[]): Op[] {
  const ops: Op[] = [];
  for (const op of frame) {
    assertValidOp(op);
    ops.push(op);
  }
  return ops;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

function callSignal(session: Session): AbortSignal {
  return AbortSignal.any([session.controller.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]);
}

export interface OfficeFeedOptions {
  /** Where the pairing grant lives; defaults to the browser's localStorage. */
  grants?: GrantStorage;
  /** Device name shown in Orbs when pairing through `pair`. */
  deviceName?: string;
}

export function createOfficeFeed({ grants = browserGrantStorage, deviceName }: OfficeFeedOptions = {}): OfficeFeedControl {
  const listeners = new Set<(event: OfficeEvent) => void>();
  let session: Session | null = null;
  let connection: ConnectionStatus = { kind: 'unpaired' };
  let state: OfficeState = { connection, bots: new Map() };
  let emitTimer: ReturnType<typeof setTimeout> | null = null;

  function dispatch(event: OfficeEvent): void {
    for (const listener of listeners) listener(event);
  }

  function rebuild(): void {
    const bots = new Map<string, BotState>();
    if (session !== null) {
      const current = session;
      const candidates: MeetingCandidate[] = [];
      let rank = 0;
      for (const item of current.conversations) {
        if (item.isHidden) continue;
        const detail = current.details.get(item.botId);
        const run = detail?.run ?? null;
        const span = run === null ? null : mainSpan(run);
        const isBusy = item.isWorking || item.isRunning;
        const activity = busyFallback(run === null ? { kind: 'idle' } : activityFromSpan(span, detail?.approvals ?? 0), isBusy);
        bots.set(item.botId, {
          id: item.botId,
          name: item.name,
          handle: item.handle,
          avatar: item.avatar,
          color: botColor(item.avatar, item.botId),
          rank: rank++,
          activity,
          run: run === null
            ? null
            : {
                id: run.id,
                trigger: run.trigger,
                title: run.title,
                startedAt: run.startedAt,
                toolCallCount: run.toolCallCount,
                tokens: run.tokens,
                isFailed: run.isFailed,
              },
          subagents: run === null ? [] : subagentsOf(run),
          nextRoutine: nextRoutine(current.routines.get(item.botId) ?? []),
          lastMessage: item.lastMessage === null
            ? null
            : { role: item.lastMessage.role, preview: item.lastMessage.preview, createdAt: item.lastMessage.createdAt },
        });
        candidates.push({
          botId: item.botId,
          name: item.name,
          handle: item.handle,
          family: activity.kind === 'tool' ? activity.family : null,
          inputs: span?.input === null || span === null ? [] : Object.values(span.input),
          hasLivePeerRun: run !== null && run.isLive && run.trigger === 'peer',
          privatePeers: detail?.peers ?? [],
          peerRunTitle: run !== null && run.isLive && run.trigger === 'peer' ? run.title : null,
        });
      }

      const now = Date.now();
      for (const [botId, partner] of current.peerPartners) {
        if (now - partner.at > PEER_PARTNER_TTL_MS) current.peerPartners.delete(botId);
      }
      const recent = new Map([...current.peerPartners].map(([botId, partner]) => [botId, partner.botId]));
      const meetings = pairMeetings(candidates, recent);
      for (const [botId, withBotIds] of meetings) {
        const partner = withBotIds[0];
        if (partner !== undefined) current.peerPartners.set(botId, { botId: partner, at: now });
      }
      for (const [botId, withBotIds] of meetings) {
        const bot = bots.get(botId);
        if (bot !== undefined) bots.set(botId, { ...bot, activity: { kind: 'meeting', withBotIds } });
      }
    }
    state = { connection, bots };
  }

  function scheduleEmit(): void {
    if (emitTimer !== null) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      rebuild();
      dispatch({ kind: 'state', state });
    }, EMIT_DELAY_MS);
  }

  function setConnection(next: ConnectionStatus): void {
    connection = next;
    scheduleEmit();
  }

  function recordError(context: string, error: unknown): void {
    const name = error instanceof Error ? error.name : 'unknown error';
    console.warn(`${context}: ${errorCode(error) ?? name}`);
  }

  function stop(): void {
    if (session !== null) {
      session.controller.abort();
      session.close();
      if (session.routineTimer !== null) clearInterval(session.routineTimer);
      session = null;
    }
  }

  function connect(grant: StoredGrant): void {
    stop();
    const controller = new AbortController();
    const { client, close } = makeOrbsClient(grant);
    const next: Session = {
      controller,
      client,
      close,
      grant,
      conversations: [],
      details: new Map(),
      routines: new Map(),
      pollers: new Set(),
      lastEntry: new Map(),
      failedRuns: new Set(),
      peerPartners: new Map(),
      isFirstSnapshot: true,
      routineTimer: null,
    };
    session = next;
    setConnection({ kind: 'connecting' });
    next.routineTimer = setInterval(() => void refreshRoutines(next), ROUTINE_INTERVAL_MS);
    void watchLoop(next).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      recordError('watch loop stopped', error);
      setConnection({ kind: 'error', message: 'The connection to the daemon failed unexpectedly.' });
    });
  }

  async function watchLoop(current: Session): Promise<void> {
    const { signal } = current.controller;
    let failures = 0;
    let hasConnected = false;

    while (!signal.aborted) {
      try {
        const frames = await current.client.conversation.watchList(undefined, { signal });
        let list: ConversationListState | undefined;
        for await (const frame of frames) {
          list = applyImmutable<ConversationListState>(list, toOps(frame));
          failures = 0;
          if (connection.kind !== 'connected') {
            hasConnected = true;
            setConnection({ kind: 'connected', serverUrl: current.grant.daemonUrl });
          }
          applyConversations(current, list.conversations);
        }
      } catch (error) {
        if (signal.aborted) return;
        const fatal = fatalMessage(errorCode(error));
        if (fatal !== null) {
          setConnection({ kind: 'error', message: fatal });
          return;
        }
        failures += 1;
        recordError('conversation stream failed', error);
        if (!hasConnected && failures >= MAX_INITIAL_FAILURES) {
          setConnection({ kind: 'error', message: 'Could not reach the daemon. Check the URL and that Orbs is running.' });
          return;
        }
      }
      if (signal.aborted) return;
      setConnection({ kind: 'connecting' });
      await sleep(RECONNECT_DELAY_MS, signal);
    }
  }

  function applyConversations(current: Session, conversations: readonly ConversationListItem[]): void {
    if (current.controller.signal.aborted) return;
    const previous = current.lastEntry;
    const wasFirst = current.isFirstSnapshot;
    current.isFirstSnapshot = false;
    current.conversations = [...conversations];

    const known = new Set<string>();
    for (const item of conversations) {
      if (item.isHidden) continue;
      known.add(item.botId);
      const entry = item.lastMessage;
      if (entry !== null) {
        const before = previous.get(item.botId);
        if (!wasFirst && before !== entry.entryId) {
          dispatch(entry.role === 'user'
            ? { kind: 'mail', botId: item.botId, trigger: 'message' }
            : { kind: 'reply', botId: item.botId, text: entry.preview });
        }
        previous.set(item.botId, entry.entryId);
      }
      if (!current.routines.has(item.botId)) void refreshBotRoutines(current, item.botId);
      if ((item.isWorking || item.isRunning) && !current.pollers.has(item.botId)) {
        current.pollers.add(item.botId);
        void pollBot(current, item.botId, wasFirst).catch((error: unknown) => recordError('poll loop stopped', error));
      }
    }
    for (const botId of current.details.keys()) {
      if (!known.has(botId)) current.details.delete(botId);
    }
    scheduleEmit();
  }

  function isBotBusy(current: Session, botId: string): boolean {
    const item = current.conversations.find((c) => c.botId === botId);
    return item !== undefined && (item.isWorking || item.isRunning);
  }

  async function pollBot(current: Session, botId: string, suppressMail: boolean): Promise<void> {
    const { signal } = current.controller;
    let trackedRunId: string | null = null;
    let isFirstRun = suppressMail;

    try {
      while (!signal.aborted) {
        try {
          const page = await current.client.activity.list({ botId }, { signal: callSignal(current) });
          const latest = page.runs[0];
          const live = page.runs.find((run) => run.isLive);

          if (latest !== undefined && latest.id === trackedRunId && latest.isFailed && !current.failedRuns.has(latest.id)) {
            current.failedRuns.add(latest.id);
            dispatch({ kind: 'failed', botId });
          }

          if (live === undefined) {
            trackedRunId = null;
            current.details.set(botId, { run: null, approvals: 0, peers: [] });
            scheduleEmit();
            if (!isBotBusy(current, botId)) return;
          } else {
            const run = await current.client.activity.run({ botId, runId: live.id }, { signal: callSignal(current) });
            const span = mainSpan(run);
            const approvals = span?.kind === 'waiting'
              ? (await current.client.tools.pending({ botId }, { signal: callSignal(current) })).length
              : 0;
            const isMessaging = span?.kind === 'tool' && toolFamily(span.tool ?? '') === 'message';
            const peers = isMessaging ? await runningPrivatePeers(current, botId) : [];

            if (run.id !== trackedRunId) {
              if (!isFirstRun && (run.trigger === 'routine' || run.trigger === 'peer')) {
                dispatch({ kind: 'mail', botId, trigger: run.trigger });
              }
              trackedRunId = run.id;
            }
            isFirstRun = false;

            if (run.isFailed && !current.failedRuns.has(run.id)) {
              current.failedRuns.add(run.id);
              dispatch({ kind: 'failed', botId });
            }
            current.details.set(botId, { run, approvals, peers });
            scheduleEmit();
          }
        } catch (error) {
          if (signal.aborted) return;
          recordError(`activity poll failed for bot ${botId}`, error);
        }
        await sleep(POLL_INTERVAL_MS, signal);
      }
    } finally {
      current.pollers.delete(botId);
    }
  }

  /** Recipients of the private conversations this bot opened that are running now. Empty when the daemon cannot say. */
  async function runningPrivatePeers(current: Session, botId: string): Promise<string[]> {
    try {
      const page = await current.client.conversation.contexts(
        { botId, kind: 'private', limit: PRIVATE_CONTEXT_LIMIT },
        { signal: callSignal(current) },
      );
      return page.items.filter((item) => item.kind === 'private' && item.isRunning).map((item) => item.botId);
    } catch (error) {
      if (!current.controller.signal.aborted) recordError(`private contexts fetch failed for bot ${botId}`, error);
      return [];
    }
  }

  async function refreshBotRoutines(current: Session, botId: string): Promise<void> {
    try {
      const routines = await current.client.routines.list({ botId }, { signal: callSignal(current) });
      if (current.controller.signal.aborted) return;
      current.routines.set(botId, routines);
      scheduleEmit();
    } catch (error) {
      if (!current.controller.signal.aborted) recordError(`routines fetch failed for bot ${botId}`, error);
    }
  }

  async function refreshRoutines(current: Session): Promise<void> {
    await Promise.allSettled(
      current.conversations.filter((c) => !c.isHidden).map((c) => refreshBotRoutines(current, c.botId)),
    );
  }

  const stored = grants.load();
  if (stored !== null) {
    try {
      connect(stored);
    } catch (error) {
      recordError('stored grant unusable', error);
      grants.clear();
    }
  }
  rebuild();

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener({ kind: 'state', state });
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    async pair(daemonUrl, pin) {
      const result = await redeemPairing(daemonUrl, pin, deviceName);
      const grant: StoredGrant = { daemonUrl: normalizeDaemonUrl(daemonUrl) ?? daemonUrl, token: result.token, serverId: result.serverId };
      grants.save(grant);
      connect(grant);
    },
    retry() {
      const grant = grants.load();
      if (grant === null) {
        stop();
        setConnection({ kind: 'unpaired' });
        return;
      }
      connect(grant);
    },
    forget() {
      stop();
      grants.clear();
      setConnection({ kind: 'unpaired' });
    },
    async history(botId, limit = HISTORY_LIMIT) {
      if (session === null || connection.kind !== 'connected') throw new SendError('Not connected to Orbs.');
      try {
        const page = await session.client.conversation.history({ botId, limit }, { signal: callSignal(session) });
        return chatLinesFrom(page);
      } catch (error) {
        recordError(`history failed for bot ${botId}`, error);
        throw new SendError('Could not load the conversation. Check the connection to Orbs.');
      }
    },
    async send(botId, content) {
      const text = content.trim();
      if (text.length === 0) throw new SendError('Type a message first.');
      if (text.length > MAX_MESSAGE_LENGTH) throw new SendError(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`);
      if (session === null || connection.kind !== 'connected') throw new SendError('Not connected to Orbs.');
      try {
        await session.client.conversation.submit(
          { botId, requestId: crypto.randomUUID(), content: text },
          { signal: callSignal(session) },
        );
      } catch (error) {
        recordError(`send failed for bot ${botId}`, error);
        throw new SendError(sendFailureMessage(errorCode(error)));
      }
    },
  };
}
