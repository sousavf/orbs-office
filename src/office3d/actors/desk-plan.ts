import type { PublicIsland } from '../../../shared/public-snapshot';
import { DESK_SLOTS } from '../layout';
import type { DeskSlot } from '../layout.types';

export interface DeskAssignment {
  readonly slot: DeskSlot;
  /** Bots past the last desk share one, nudged sideways by this many laps. */
  readonly wrap: number;
}

export interface DeskCandidate {
  readonly id: string;
  readonly rank: number;
}

/**
 * Desk for every bot, derived from the roster order and the owner's island choices alone, so nothing
 * needs saving. Bots that picked an island or a solo desk take the first free desk there; the rest
 * keep the desk of their rank when it is still free and otherwise the first free one in island order.
 * A choice whose island is full falls back to automatic; with no desk left a bot shares one.
 */
export function assignDesks(
  bots: readonly DeskCandidate[],
  choice: (botId: string) => PublicIsland,
): Map<string, DeskAssignment> {
  const ordered = [...bots].sort((a, b) => a.rank - b.rank);
  const taken = new Set<number>();
  const plan = new Map<string, DeskAssignment>();
  const take = (id: string, slot: DeskSlot | undefined, wrap = 0): boolean => {
    if (slot === undefined) return false;
    taken.add(slot.id);
    plan.set(id, { slot, wrap });
    return true;
  };
  const free = (slot: DeskSlot): boolean => !taken.has(slot.id);

  for (const bot of ordered) {
    const wanted = choice(bot.id);
    if (wanted !== 'auto') take(bot.id, DESK_SLOTS.find((slot) => slot.islandId === wanted && free(slot)));
  }
  let shared = 0;
  for (const bot of ordered) {
    if (plan.has(bot.id)) continue;
    const home = DESK_SLOTS[bot.rank];
    if (home !== undefined && free(home) && take(bot.id, home)) continue;
    if (take(bot.id, DESK_SLOTS.find(free))) continue;
    const slot = DESK_SLOTS[shared % DESK_SLOTS.length];
    take(bot.id, slot, 1 + Math.floor(shared / DESK_SLOTS.length));
    shared += 1;
  }
  return plan;
}
