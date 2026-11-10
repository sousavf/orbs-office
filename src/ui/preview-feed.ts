// Dev-only fake feed used when the URL has `?preview`. Never part of the default path.
import type {
  BotActivity,
  ChatControl,
  ChatLine,
  BotState,
  OfficeEvent,
  OfficeFeed,
  OfficeState,
  SubagentState,
} from '../feed/office.types';

const STEP_MS = 3500;
const DEFAULT_BOTS = 3;
const MAX_BOTS = 40;

interface PreviewStep {
  readonly activities: Readonly<Record<string, BotActivity>>;
  readonly subagents?: readonly SubagentState[];
  /** How long this step lasts; defaults to STEP_MS. */
  readonly holdMs?: number;
  readonly mail?: string;
  readonly failed?: string;
}

const STEPS: readonly PreviewStep[] = [
  { activities: {}, holdMs: 9000 },
  // Ends before Ada reaches her desk, so the arrival dwell is visible.
  { activities: { ada: { kind: 'thinking' } }, mail: 'ada', holdMs: 700 },
  { activities: {}, holdMs: 7000 },
  { activities: { ada: { kind: 'thinking' } }, mail: 'ada', holdMs: 7000 },
  {
    activities: {
      ada: { kind: 'tool', tool: 'bash', family: 'terminal' },
      bo: { kind: 'thinking' },
    },
  },
  {
    activities: {
      ada: { kind: 'tool', tool: 'web_fetch', family: 'web' },
      bo: { kind: 'tool', tool: 'read_file', family: 'file' },
    },
    subagents: [{ id: 'ada-1', name: 'Researcher', activity: { kind: 'thinking' } }],
  },
  // A tool span shorter than the bubble's minimum, followed by thinking.
  { activities: { ada: { kind: 'tool', tool: 'bash', family: 'terminal' }, bo: { kind: 'thinking' } }, holdMs: 900 },
  { activities: { ada: { kind: 'thinking' }, bo: { kind: 'thinking' } }, holdMs: 3000 },
  {
    activities: {
      ada: { kind: 'waiting', approvalCount: 2 },
      bo: { kind: 'meeting', withBotIds: ['cy'] },
      cy: { kind: 'meeting', withBotIds: ['bo'] },
    },
    subagents: [
      { id: 'ada-1', name: 'Researcher', activity: { kind: 'tool', tool: 'search', family: 'mcp' } },
      { id: 'ada-2', name: null, activity: { kind: 'tool', tool: 'ls', family: 'other' } },
    ],
    // Long enough for both to walk to the room and sit for a while.
    holdMs: 11000,
  },
  {
    activities: {
      ada: { kind: 'tool', tool: 'bot_message', family: 'message' },
      bo: { kind: 'thinking' },
      cy: { kind: 'thinking' },
    },
    mail: 'bo',
    failed: 'cy',
  },
];

interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

const SCRIPTED_ROSTER: readonly RosterEntry[] = [
  { id: 'ada', name: 'Ada', color: '#7c5cff' },
  { id: 'bo', name: 'Bo', color: '#e8833a' },
  { id: 'cy', name: 'Cy', color: '#2fb6a3' },
];

const EXTRA_NAMES: readonly string[] = [
  'Dara', 'Eli', 'Fen', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kit', 'Lia', 'Mo', 'Nia', 'Oz',
  'Pia', 'Quin', 'Rex', 'Sol', 'Tia', 'Uma', 'Vik', 'Wren', 'Xan', 'Yara', 'Zed',
];

/** Names used by `?record` so promo footage shows callsigns instead of the demo names. */
const CALLSIGNS: readonly string[] = [
  'Viper', 'Maverick', 'Bunker', 'Pixel', 'Hawkeye', 'Sentinel', 'Judge', 'Warden', 'Ledger', 'Herald', 'Oracle', 'Postman', 'Ace',
];

function isRecording(): boolean {
  return new URLSearchParams(window.location.search).has('record');
}

const GOLDEN_ANGLE = 137.508;

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function makeRoster(count: number): readonly RosterEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const callsign = isRecording() ? CALLSIGNS[index] : undefined;
    const scripted = SCRIPTED_ROSTER[index];
    if (scripted !== undefined) return callsign === undefined ? scripted : { ...scripted, name: callsign };
    if (callsign !== undefined) return { id: `bot-${index}`, name: callsign, color: hslToHex((index * GOLDEN_ANGLE) % 360, 0.62, 0.55) };
    const name = EXTRA_NAMES[(index - SCRIPTED_ROSTER.length) % EXTRA_NAMES.length] ?? `Bot ${index}`;
    const lap = Math.floor((index - SCRIPTED_ROSTER.length) / EXTRA_NAMES.length);
    return {
      id: `bot-${index}`,
      name: lap === 0 ? name : `${name} ${lap + 1}`,
      color: hslToHex((index * GOLDEN_ANGLE) % 360, 0.62, 0.55),
    };
  });
}

/** `?bots=N`, clamped to 1..40; three scripted bots when absent or malformed. */
function previewBotCount(): number {
  const raw = Number.parseInt(new URLSearchParams(window.location.search).get('bots') ?? '', 10);
  return Number.isNaN(raw) ? DEFAULT_BOTS : Math.min(MAX_BOTS, Math.max(1, raw));
}

const EXTRA_FAMILIES = ['terminal', 'web', 'file', 'mcp', 'other'] as const;
const EXTRA_CYCLE = 8;

/** Bots beyond the scripted three run their own staggered loop so the floor stays busy. */
function extraActivity(index: number, stepIndex: number): BotActivity {
  const phase = (stepIndex + index * 3) % EXTRA_CYCLE;
  if (phase < 3) return { kind: 'idle' };
  if (phase === 3) return { kind: 'thinking' };
  if (phase === 4 || phase === 5) {
    const family = EXTRA_FAMILIES[(index + stepIndex) % EXTRA_FAMILIES.length] ?? 'other';
    return { kind: 'tool', tool: `${family}_call`, family };
  }
  if (phase === 6 && index % 7 === 0) return { kind: 'waiting', approvalCount: 1 + (index % 3) };
  return { kind: 'thinking' };
}

/** `?quiet` (implied by `?clock=`): the office is mostly idle so the daily routine shows; one bot at a time works briefly (`?quiet=still`: nobody does). */
function isQuiet(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('quiet') || params.has('clock');
}

const QUIET_PERIOD = 14;

function quietActivity(index: number, stepIndex: number): BotActivity {
  if (new URLSearchParams(window.location.search).get('quiet') === 'still') return { kind: 'idle' };
  return (stepIndex + index) % QUIET_PERIOD === 0 ? { kind: 'thinking' } : { kind: 'idle' };
}

type LastMessage = NonNullable<BotState['lastMessage']>;

function buildState(
  roster: readonly RosterEntry[],
  stepIndex: number,
  startedAt: number,
  lastMessages: ReadonlyMap<string, LastMessage>,
  overrides: ReadonlyMap<string, BotActivity> = new Map(),
): OfficeState {
  const step = STEPS[stepIndex % STEPS.length];
  const bots = new Map<string, BotState>();
  roster.forEach((entry, rank) => {
    const scripted = rank < SCRIPTED_ROSTER.length;
    const natural = isQuiet()
      ? quietActivity(rank, stepIndex)
      : scripted
        ? (step?.activities[entry.id] ?? { kind: 'idle' })
        : extraActivity(rank, stepIndex);
    const activity: BotActivity = overrides.get(entry.id) ?? natural;
    const active = activity.kind !== 'idle';
    bots.set(entry.id, {
      id: entry.id,
      name: entry.name,
      handle: entry.name.toLowerCase(),
      avatar: null,
      color: entry.color,
      rank,
      activity,
      run: active
        ? {
            id: `run-${entry.id}`,
            trigger: 'message',
            title: 'Summarise the weekly report',
            startedAt,
            toolCallCount: stepIndex * 3,
            tokens: stepIndex * 1840,
            isFailed: false,
          }
        : null,
      subagents: entry.id === 'ada' ? [...(step?.subagents ?? [])] : [],
      lastMessage: lastMessages.get(entry.id) ?? null,
      nextRoutine:
        rank === 0
          ? { name: 'Daily digest', at: Date.now() + 20 * 60_000 }
          : rank === 1
            ? { name: 'Inbox sweep', at: Date.now() + 95 * 60_000 }
            : rank === 2
              ? { name: 'Price watch', at: Date.now() + 160 * 60_000 }
              : null,
    });
  });
  // An empty server URL is unparsable, so no avatar request is attempted for fake bots.
  return { connection: { kind: 'connected', serverUrl: '' }, bots };
}

const SEND_MS = 400;
const REPLY_MS = 2500;
const CANNED_REPLY = "On it! I'll look into that.";

export function createPreviewFeed(): OfficeFeed & ChatControl {
  const listeners = new Set<(event: OfficeEvent) => void>();
  const startedAt = Date.now();
  const roster = makeRoster(previewBotCount());
  let stepIndex = 0;
  const lastMessages = new Map<string, LastMessage>([
    ['ada', { role: 'assistant', preview: 'The daily digest is ready. Three items need your review.', createdAt: Date.now() - 180_000 }],
  ]);
  const overrides = new Map<string, BotActivity>();
  let state = buildState(roster, stepIndex, startedAt, lastMessages, overrides);
  let lineId = 0;
  const logs = new Map<string, ChatLine[]>([
    [
      'ada',
      [
        { id: ++lineId, role: 'user', text: 'Can you prepare the daily digest?', at: Date.now() - 600_000 },
        { id: ++lineId, role: 'assistant', text: 'Sure.\nI will collect the overnight items and summarise them.', at: Date.now() - 540_000 },
        { id: ++lineId, role: 'assistant', text: 'The daily digest is ready. Three items need your review.', at: Date.now() - 180_000 },
      ],
    ],
  ]);
  const addLine = (botId: string, role: ChatLine['role'], text: string): void => {
    logs.set(botId, [...(logs.get(botId) ?? []), { id: ++lineId, role, text, at: Date.now() }]);
  };

  const emit = (event: OfficeEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const advance = (): void => {
    stepIndex += 1;
    state = buildState(roster, stepIndex, startedAt, lastMessages, overrides);
    emit({ kind: 'state', state });
    const step = STEPS[stepIndex % STEPS.length];
    if (step?.mail !== undefined) emit({ kind: 'mail', botId: step.mail, trigger: 'message' });
    if (step?.failed !== undefined) emit({ kind: 'failed', botId: step.failed });
    window.setTimeout(advance, step?.holdMs ?? STEP_MS);
  };
  // Recording scripts every activity and delivery themselves through __previewControl.
  if (!isRecording()) window.setTimeout(advance, STEPS[0]?.holdMs ?? STEP_MS);

  // Dev hook for scripted runs: window.__previewControl.setActivity('bot-3', { kind: 'thinking' }), null to release.
  Object.assign(window, {
    __previewControl: {
      setActivity(botId: string, activity: BotActivity | null) {
        if (activity === null) overrides.delete(botId);
        else overrides.set(botId, activity);
        state = buildState(roster, stepIndex, startedAt, lastMessages, overrides);
        emit({ kind: 'state', state });
      },
      /** Sends a courier with an envelope to the bot's desk. */
      mail(botId: string) {
        emit({ kind: 'mail', botId, trigger: 'message' });
      },
      reply(botId: string, text: string) {
        emit({ kind: 'reply', botId, text });
      },
      roster: roster.map((entry) => entry.id),
    },
  });

  const setLast = (botId: string, message: LastMessage): void => {
    lastMessages.set(botId, message);
    state = buildState(roster, stepIndex, startedAt, lastMessages, overrides);
    emit({ kind: 'state', state });
  };

  return {
    getState: () => state,
    async history(botId) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      return logs.get(botId) ?? [];
    },
    async send(botId, content) {
      await new Promise((resolve) => window.setTimeout(resolve, SEND_MS));
      emit({ kind: 'mail', botId, trigger: 'message' });
      addLine(botId, 'user', content);
      setLast(botId, { role: 'user', preview: content.slice(0, 160), createdAt: Date.now() });
      window.setTimeout(() => {
        addLine(botId, 'assistant', CANNED_REPLY);
        emit({ kind: 'reply', botId, text: CANNED_REPLY });
        setLast(botId, { role: 'assistant', preview: CANNED_REPLY, createdAt: Date.now() });
      }, REPLY_MS);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ kind: 'state', state });
      return () => listeners.delete(listener);
    },
  };
}
