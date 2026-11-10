import type { ActivityTrigger, BotAvatar } from '../orbs/orbs.types';

/** What a bot is visibly doing. Derived only from real daemon state. */
export type BotActivity =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'tool'; tool: string; family: ToolFamily }
  | { kind: 'waiting'; approvalCount: number }
  | { kind: 'meeting'; withBotIds: string[] };

export type ToolFamily = 'terminal' | 'web' | 'file' | 'mcp' | 'message' | 'other';

export interface SubagentState {
  id: string;
  name: string | null;
  activity: BotActivity;
}

export interface RunInfo {
  id: string;
  trigger: ActivityTrigger;
  title: string | null;
  startedAt: number;
  toolCallCount: number;
  tokens: number;
  isFailed: boolean;
}

export interface BotState {
  id: string;
  name: string;
  handle: string;
  avatar: BotAvatar | null;
  /** Hex colour like '#7c5cff', derived from the avatar or a stable hash of the id. */
  color: string;
  /** Order in the roster; used for stable desk assignment. */
  rank: number;
  activity: BotActivity;
  run: RunInfo | null;
  subagents: SubagentState[];
  nextRoutine: { name: string; at: number } | null;
  /** The latest message in the bot's main chat, for the instruction popup. */
  lastMessage: { role: 'user' | 'assistant'; preview: string; createdAt: number } | null;
}

/** One message of a bot's main chat, as shown in the popup log. */
export interface ChatLine {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Milliseconds since the epoch; 0 when unknown. */
  at: number;
}

export type ConnectionStatus =
  | { kind: 'unpaired' }
  | { kind: 'connecting' }
  | { kind: 'connected'; serverUrl: string }
  | { kind: 'error'; message: string };

export interface OfficeState {
  connection: ConnectionStatus;
  bots: ReadonlyMap<string, BotState>;
}

export type OfficeEvent =
  | { kind: 'state'; state: OfficeState }
  /** A new incoming message or routine fire for a bot: courier carries an envelope from the mailroom. */
  | { kind: 'mail'; botId: string; trigger: ActivityTrigger }
  /** A bot just finished with a failure: show a brief "!" bubble. */
  | { kind: 'failed'; botId: string }
  /** A bot posted a new reply in its main chat; `text` is the daemon's preview (up to 160 characters). */
  | { kind: 'reply'; botId: string; text: string };

export interface OfficeFeed {
  /** Calls the listener with the current state immediately, then on every event. */
  subscribe(listener: (event: OfficeEvent) => void): () => void;
  getState(): OfficeState;
}

/** The feed plus the actions the connection panel needs. */
export interface ConnectionControl extends OfficeFeed {
  /** Redeem a pairing PIN against a daemon URL, store the grant, then connect. */
  pair(daemonUrl: string, pin: string): Promise<void>;
  /** Reconnect with the stored grant after an error. */
  retry(): void;
  /** Drop the stored grant and go back to unpaired. */
  forget(): void;
}

/** What the instruction popup needs. Both reject with `SendError` carrying a user-facing message. */
export interface ChatControl {
  /** Send a message to the bot's main chat, as if typed in Orbs. */
  send(botId: string, content: string): Promise<void>;
  /** Recent messages of the bot's main chat, oldest first. */
  history(botId: string, limit?: number): Promise<ChatLine[]>;
}

/** The live feed: state, connection actions and chat. */
export type OfficeFeedControl = ConnectionControl & ChatControl;
