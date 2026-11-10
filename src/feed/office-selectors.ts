import type { BotState } from './office.types';

export interface UpcomingRoutine {
  readonly name: string;
  readonly at: number;
}

/** Soonest routines across all bots, for the legend and the in-world mailroom board. */
export function upcomingRoutines(bots: ReadonlyMap<string, BotState>, limit: number): UpcomingRoutine[] {
  const routines: UpcomingRoutine[] = [];
  for (const bot of bots.values()) {
    if (bot.nextRoutine !== null) routines.push(bot.nextRoutine);
  }
  return routines.sort((a, b) => a.at - b.at).slice(0, limit);
}
