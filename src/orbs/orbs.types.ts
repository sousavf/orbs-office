// Hand-written mirror of the subset of the Orbs oRPC contract this app reads.
// Source of truth: orbs/packages/contracts/src/types/*.types.ts

export const ORBS_PROTOCOL = {
  version: 1,
  versionHeader: 'x-bots-protocol',
  serverIdHeader: 'x-bots-server-id',
  rpcPath: '/rpc',
} as const;

export type BotAvatar =
  | { kind: 'blob'; body: string; color: string; expression: string }
  | { kind: 'image'; src: string }
  | { kind: 'color'; color: string };

export interface ConversationListItem {
  botId: string;
  conversationId: number;
  name: string;
  handle: string;
  avatar: BotAvatar | null;
  isRunning: boolean;
  isWorking: boolean;
  isHidden: boolean;
  lastMessage: {
    entryId: number;
    role: 'user' | 'assistant';
    preview: string;
    createdAt: number;
  } | null;
}

export interface ConversationListState {
  conversations: ConversationListItem[];
  sections: unknown[];
}

export type ActivityTrigger = 'message' | 'routine' | 'reaction' | 'subagent' | 'peer' | 'other';

export interface ActivityRunSummary {
  id: string;
  trigger: ActivityTrigger;
  title: string | null;
  startedAt: number;
  durationMs: number;
  agentCount: number;
  toolCallCount: number;
  tokens: number;
  cost: number;
  isFailed: boolean;
  isLive: boolean;
}

export interface ActivityPage {
  runs: ActivityRunSummary[];
  nextBefore: number | null;
}

export interface ActivityAgent {
  id: string;
  conversationId: number;
  name: string | null;
  model: string | null;
  isMain: boolean;
}

export type ActivitySpanKind = 'thinking' | 'tool' | 'waiting';

export interface ActivitySpan {
  id: string;
  agentId: string;
  kind: ActivitySpanKind;
  start: number;
  end: number | null;
  tool: string | null;
  calls: string[];
  stop: string | null;
  tokens: number | null;
  cost: number | null;
  isFailed: boolean;
  isRetry: boolean;
  detail: string | null;
  input: Record<string, string> | null;
}

export interface ActivityHandoff {
  from: string;
  to: string;
  at: number;
  kind: 'dispatch' | 'result';
}

export interface ActivityRun extends ActivityRunSummary {
  agents: ActivityAgent[];
  spans: ActivitySpan[];
  handoffs: ActivityHandoff[];
}

export interface Routine {
  id: string;
  botId: string;
  name: string;
  isEnabled: boolean;
  nextRunAt: number | null;
}

export interface ToolApproval {
  id: number;
  botId: string;
  conversationId: number;
  toolName: string;
  createdAt: number;
  expiresAt: number;
}

export interface ServerAddress {
  url: string;
}

export interface PairingRedeemResult {
  token: string;
  serverId: string;
  addresses: ServerAddress[];
}

/** Another conversation tied to a bot's main chat; only the fields this app reads. */
export interface ConversationContextItem {
  kind: 'subagent' | 'private';
  /** For `private`: the bot on the other side of the conversation. */
  botId: string;
  conversationId: number;
  isRunning: boolean;
}

export interface ConversationContextPage {
  items: ConversationContextItem[];
}

/** The procedures this app calls, typed by hand. */
export interface OrbsClient {
  conversation: {
    watchList(input?: undefined, options?: { signal?: AbortSignal }): Promise<AsyncIterable<readonly unknown[]>>;
    submit(
      input: { botId: string; requestId: string; content: string },
      options?: { signal?: AbortSignal },
    ): Promise<{ submissionId: number }>;
    history(
      input: { botId: string; limit?: number },
      options?: { signal?: AbortSignal },
    ): Promise<unknown>;
    contexts(
      input: { botId: string; kind: 'subagent' | 'private'; limit?: number },
      options?: { signal?: AbortSignal },
    ): Promise<ConversationContextPage>;
  };
  activity: {
    list(input: { botId: string; before?: number }, options?: { signal?: AbortSignal }): Promise<ActivityPage>;
    run(input: { botId: string; runId: string }, options?: { signal?: AbortSignal }): Promise<ActivityRun>;
  };
  routines: {
    list(input: { botId: string }, options?: { signal?: AbortSignal }): Promise<Routine[]>;
  };
  tools: {
    pending(input: { botId: string }, options?: { signal?: AbortSignal }): Promise<ToolApproval[]>;
  };
}
