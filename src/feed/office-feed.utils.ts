import type {
  ActivityAgent,
  ActivityRun,
  ActivitySpan,
  BotAvatar,
  Routine,
} from '../orbs/orbs.types';
import type { BotActivity, ChatLine, SubagentState, ToolFamily } from './office.types';

const BLOB_COLORS: Readonly<Record<string, string>> = {
  ink: '#0a0a0c',
  brown: '#8b5e3c',
  red: '#e8483f',
  orange: '#f08a24',
  amber: '#f0b429',
  green: '#3ecf8e',
  turquoise: '#2fbfa0',
  blue: '#3b93f0',
  violet: '#8b5cf6',
  pink: '#e152b0',
  grey: '#a3a3a3',
  cream: '#f1efe9',
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function toolFamily(tool: string): ToolFamily {
  const name = tool.toLowerCase();
  if (name.startsWith('bot_message')) return 'message';
  if (name.includes('mcp') || name.includes('__')) return 'mcp';
  const words = new Set(name.split(/[^a-z0-9]+/));
  const has = (parts: readonly string[]): boolean => parts.some((part) => words.has(part));
  if (has(['bash', 'shell', 'exec', 'terminal'])) return 'terminal';
  if (has(['web', 'fetch', 'http', 'browser', 'search', 'websearch', 'webfetch'])) return 'web';
  if (has(['read', 'write', 'edit', 'file', 'files', 'glob', 'grep', 'ls'])) return 'file';
  return 'other';
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Stable colour for a bot: its avatar colour when known, else a hash of the id. */
export function botColor(avatar: BotAvatar | null, botId: string): string {
  const named = avatar?.kind === 'color' || avatar?.kind === 'blob' ? avatar.color : null;
  if (named !== null) {
    if (HEX_COLOR.test(named)) return named.toLowerCase();
    const mapped = BLOB_COLORS[named.toLowerCase()];
    if (mapped !== undefined) return mapped;
  }
  return hslToHex(hashString(botId) % 360, 0.6, 0.55);
}

/** Latest span of an agent, preferring one that is still open. */
export function currentSpan(spans: readonly ActivitySpan[], agentId: string): ActivitySpan | null {
  let latest: ActivitySpan | null = null;
  let latestOpen: ActivitySpan | null = null;
  for (const span of spans) {
    if (span.agentId !== agentId) continue;
    if (latest === null || span.start >= latest.start) latest = span;
    if (span.end === null && (latestOpen === null || span.start >= latestOpen.start)) latestOpen = span;
  }
  return latestOpen ?? latest;
}

export function activityFromSpan(span: ActivitySpan | null, approvalCount: number): BotActivity {
  if (span === null) return { kind: 'idle' };
  switch (span.kind) {
    case 'thinking':
      return { kind: 'thinking' };
    case 'waiting':
      return { kind: 'waiting', approvalCount };
    case 'tool': {
      const tool = span.tool ?? 'tool';
      return { kind: 'tool', tool, family: toolFamily(tool) };
    }
  }
}

export function mainAgent(run: ActivityRun): ActivityAgent | null {
  return run.agents.find((agent) => agent.isMain) ?? null;
}

export function mainSpan(run: ActivityRun): ActivitySpan | null {
  const agent = mainAgent(run);
  return agent === null ? null : currentSpan(run.spans, agent.id);
}

export function subagentsOf(run: ActivityRun): SubagentState[] {
  const result: SubagentState[] = [];
  for (const agent of run.agents) {
    if (agent.isMain) continue;
    const span = currentSpan(run.spans, agent.id);
    if (span === null || span.end !== null) continue;
    result.push({ id: agent.id, name: agent.name, activity: activityFromSpan(span, 0) });
  }
  return result;
}

export function nextRoutine(routines: readonly Routine[]): { name: string; at: number } | null {
  let best: { name: string; at: number } | null = null;
  for (const routine of routines) {
    if (!routine.isEnabled || routine.nextRunAt === null) continue;
    if (best === null || routine.nextRunAt < best.at) best = { name: routine.name, at: routine.nextRunAt };
  }
  return best;
}

export interface MeetingCandidate {
  botId: string;
  name: string;
  handle: string;
  /** Family of the main agent's current tool, if it is running one. */
  family: ToolFamily | null;
  /** Values of the current tool span's input, for naming the peer. */
  inputs: readonly string[];
  hasLivePeerRun: boolean;
  /** Title of the live peer run; Orbs starts delivered bot messages with "[Private message from <name>.". */
  peerRunTitle: string | null;
}

const PEER_SENDER = /^\[Private message from (.+?)\. /;

/** The sender's display name from a peer run title, when the run is a delivered bot message. */
export function peerSenderName(title: string | null): string | null {
  return title === null ? null : (PEER_SENDER.exec(title)?.[1] ?? null);
}

/**
 * Pairs bots that are talking to each other. A peer run names its sender in the title; a peer reply does not, so
 * `recentPartners` (botId -> partner remembered from an earlier named message) covers the reply direction. The
 * sending bot's own `bot_message` call is a last resort. Returns botId -> partner ids.
 */
export function pairMeetings(
  candidates: readonly MeetingCandidate[],
  recentPartners: ReadonlyMap<string, string> = new Map(),
): Map<string, string[]> {
  const meetings = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const list = meetings.get(from) ?? [];
      if (!list.includes(to)) list.push(to);
      meetings.set(from, list);
    }
  };

  for (const recipient of candidates) {
    if (!recipient.hasLivePeerRun) continue;
    const senderName = peerSenderName(recipient.peerRunTitle);
    const sender = senderName === null
      ? candidates.find((c) => c.botId === recentPartners.get(recipient.botId))
      : candidates.find((c) => c.botId !== recipient.botId && c.name === senderName);
    if (sender !== undefined) link(recipient.botId, sender.botId);
  }

  for (const sender of candidates) {
    if (sender.family !== 'message') continue;
    const peers = candidates.filter((c) => c.hasLivePeerRun && c.botId !== sender.botId);
    const haystack = sender.inputs.join('\n').toLowerCase();
    const named = peers.find((peer) => mentions(haystack, peer));
    const target = named ?? (peers.length === 1 ? peers[0] : undefined);
    if (target !== undefined) link(sender.botId, target.botId);
  }
  return meetings;
}

function mentions(haystack: string, peer: MeetingCandidate): boolean {
  const handle = peer.handle.replace(/^@/, '').toLowerCase();
  const name = peer.name.toLowerCase();
  return (handle.length > 0 && haystack.includes(handle)) || (name.length > 0 && haystack.includes(name));
}

const FATAL_CODES: Readonly<Record<string, string>> = {
  UNAUTHORIZED: 'The daemon rejected this device. Pair again with a new PIN.',
  PROTOCOL_MISMATCH: 'This daemon speaks a different protocol version than Orbs Office.',
  SERVER_MISMATCH: 'This address now belongs to a different Orbs server. Pair again.',
};

/** Human-readable message when the oRPC error code means retrying cannot help; otherwise null. */
export function fatalMessage(code: string | null): string | null {
  if (code === null) return null;
  return FATAL_CODES[code] ?? null;
}

const SILENT_REPLIES: readonly string[] = ['NO_REPLY', '<|eos|>'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
  }
  return parts.join(' ');
}

function chatLineOf(entry: unknown): ChatLine | null {
  if (!isRecord(entry) || typeof entry.id !== 'number') return null;
  const first: unknown = Array.isArray(entry.model) ? entry.model[0] : undefined;
  const message = isRecord(first) ? first : null;
  const at = message !== null && typeof message.timestamp === 'number' ? message.timestamp : 0;
  const role = message?.role;
  if (role === 'user' || role === 'assistant') {
    const text = textOf(message?.content).trim();
    if (text !== '' && !(role === 'assistant' && SILENT_REPLIES.includes(text))) {
      return { id: entry.id, role, text, at };
    }
  }
  if (isRecord(entry.data) && typeof entry.data.content === 'string' && entry.data.content.trim() !== '') {
    return { id: entry.id, role: 'user', text: entry.data.content.trim(), at };
  }
  return null;
}

/** Chat lines from a `conversation.history` page, oldest first whichever way the daemon orders it. */
export function chatLinesFrom(page: unknown): ChatLine[] {
  const items: unknown = isRecord(page) ? page.items : undefined;
  if (!Array.isArray(items)) return [];
  const lines: ChatLine[] = [];
  for (const item of items) {
    const line = chatLineOf(item);
    if (line !== null) lines.push(line);
  }
  return lines.sort((a, b) => a.id - b.id);
}
