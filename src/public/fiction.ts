import { loremRoutineName } from './lorem';

export interface FakeRoutine {
  readonly name: string;
  /** Milliseconds since the epoch. */
  readonly at: number;
}

const COUNT = 4;
const FIVE_MINUTES_MS = 5 * 60_000;
const MIN_AHEAD_MS = 5 * 60_000;
const MAX_AHEAD_MS = 3 * 60 * 60_000;
/** Chance that a refresh swaps one upcoming routine for a new one, so the board changes now and then. */
const SWAP_CHANCE = 0.12;

function makeRoutine(now: number): FakeRoutine {
  const at = now + MIN_AHEAD_MS + Math.random() * (MAX_AHEAD_MS - MIN_AHEAD_MS);
  return { name: loremRoutineName(), at: Math.round(at / FIVE_MINUTES_MS) * FIVE_MINUTES_MS };
}

/**
 * Made-up "upcoming routines" for the mailroom board, generated in the browser at random.
 * Entries that come due are replaced, and now and then one is swapped early.
 */
export class FakeRoutines {
  private routines: FakeRoutine[] = [];

  /** Brings the list up to date; returns true when it changed. */
  refresh(now: number): boolean {
    const before = this.routines.map((routine) => routine.name + routine.at).join('|');
    this.routines = this.routines.filter((routine) => routine.at > now);
    if (this.routines.length > 0 && Math.random() < SWAP_CHANCE) {
      this.routines.splice(Math.floor(Math.random() * this.routines.length), 1);
    }
    while (this.routines.length < COUNT) this.routines.push(makeRoutine(now));
    this.routines.sort((a, b) => a.at - b.at);
    return this.routines.map((routine) => routine.name + routine.at).join('|') !== before;
  }

  get list(): readonly FakeRoutine[] {
    return this.routines;
  }
}
