// A development-only feed of invented bots for testing the publishing path (relays, failover, counts) without a
// daemon: `bun run bridge --synthetic`. Nothing here is read from the owner's data.

import type { BotActivity, BotState, OfficeEvent, OfficeFeed, OfficeState } from '../src/feed/office.types';

const BOT_COUNT = 4;
const STEP_MS = 4_000;
const COLORS = ['#3b93f0', '#e0644a', '#4caf7d', '#c58af9'];
const ACTIVITIES: BotActivity[] = [
  { kind: 'idle' },
  { kind: 'thinking' },
  { kind: 'tool', tool: 'x', family: 'terminal' },
  { kind: 'tool', tool: 'x', family: 'web' },
  { kind: 'tool', tool: 'x', family: 'file' },
];

function makeBot(index: number, step: number): BotState {
  const activity = ACTIVITIES[(index + step) % ACTIVITIES.length] ?? { kind: 'idle' };
  return {
    id: `synthetic-bot-${index}`,
    name: `Synthetic ${index + 1}`,
    handle: '',
    avatar: null,
    color: COLORS[index % COLORS.length] ?? '#3b93f0',
    rank: index,
    activity,
    run:
      activity.kind === 'idle'
        ? null
        : { id: '', trigger: 'message', title: null, startedAt: Date.now() - 30_000, toolCallCount: 0, tokens: 0, isFailed: false },
    subagents: [],
    nextRoutine: null,
    lastMessage: null,
  };
}

function makeState(step: number): OfficeState {
  const bots = new Map<string, BotState>();
  for (let index = 0; index < BOT_COUNT; index += 1) {
    const bot = makeBot(index, step);
    bots.set(bot.id, bot);
  }
  return { connection: { kind: 'connected', serverUrl: '' }, bots };
}

export function createSyntheticFeed(): OfficeFeed {
  const listeners = new Set<(event: OfficeEvent) => void>();
  let step = 0;
  let state = makeState(step);
  setInterval(() => {
    step += 1;
    state = makeState(step);
    for (const listener of [...listeners]) listener({ kind: 'state', state });
    if (step % 3 === 0) {
      for (const listener of [...listeners]) listener({ kind: 'mail', botId: `synthetic-bot-${step % BOT_COUNT}`, trigger: 'message' });
    }
  }, STEP_MS);
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener({ kind: 'state', state });
      return () => listeners.delete(listener);
    },
  };
}
