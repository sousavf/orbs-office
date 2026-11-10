import type { BotActivity, BotState } from '../feed/office.types';
import type { IdlePlace } from '../office-contracts';

const IDLE_TEXT: Readonly<Record<IdlePlace, string>> = {
  desk: 'At desk',
  break: 'On a break',
  lounge: 'In the lounge',
  pool: 'Playing pool',
  foosball: 'Playing table football',
  console: 'Playing console',
  lunch: 'At lunch',
  bedtime: 'Heading to bed',
  sleeping: 'Sleeping',
};

/** Plain-language activity so state never depends on colour or icon alone. */
export function describeActivity(
  activity: BotActivity,
  bots: ReadonlyMap<string, BotState>,
  place?: IdlePlace,
): string {
  switch (activity.kind) {
    case 'idle':
      return place === undefined ? 'Idle' : IDLE_TEXT[place];
    case 'thinking':
      return 'Thinking';
    case 'tool':
      return `Using ${activity.tool}`;
    case 'waiting':
      return `Waiting for approval (${activity.approvalCount})`;
    case 'meeting': {
      const names = activity.withBotIds.map((id) => bots.get(id)?.name ?? 'a colleague');
      return names.length > 0 ? `In a meeting with ${names.join(', ')}` : 'In a meeting';
    }
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
