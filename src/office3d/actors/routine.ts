import { type Clock, type Timer, cancelTimer } from './clock';
import type { Phase } from './schedule';
import type { Want } from './types';

export type BreakSpot = 'kitchen' | 'cooler' | 'lounge' | 'games';

/** All durations are minutes of schedule time (they shrink with the dev `timeScale`). */
type Range = readonly [number, number];

interface Pacing {
  readonly gap: Range;
  readonly length: Range;
  readonly weights: Readonly<Record<BreakSpot, number>>;
}

const PACING: Readonly<Record<'work' | 'winddown', Pacing>> = {
  work: { gap: [8, 15], length: [1.5, 3], weights: { kitchen: 0.35, cooler: 0.15, lounge: 0.2, games: 0.3 } },
  winddown: { gap: [1.5, 4], length: [3, 6], weights: { kitchen: 0.4, cooler: 0, lounge: 0.2, games: 0.4 } },
};
const COOLER_LENGTH: Range = [0.5, 1];
/** A phase change reaches each bot a little apart, so the office does not stand up as one. */
const PHASE_SPREAD_MIN = 1;
const FIRST_GAP_MIN = 1;
const RETRY_MIN: Range = [0.5, 1];

function between([min, max]: Range): number {
  return min + Math.random() * (max - min);
}

function chooseSpot(weights: Readonly<Record<BreakSpot, number>>): BreakSpot {
  const entries = Object.entries(weights) as [BreakSpot, number][];
  let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [spot, weight] of entries) {
    roll -= weight;
    if (roll < 0) return spot;
  }
  return 'kitchen';
}

export interface RoutineHooks {
  /** The intent changed; the bot should look again at where it wants to be. */
  changed(): void;
  /** Whether another bot may start a break now (only a share of the idle bots are on one at a time). */
  mayBreak(): boolean;
}

/**
 * What an idle bot does with its day. In working hours it sits at its desk and now and then takes a
 * short break somewhere else; at lunch it eats; outside working hours it sleeps. Real activity is
 * handled by the actor and always wins; this only answers "where would it be if it had nothing to do".
 */
export class Routine {
  private phase: Phase = 'work';
  private pendingPhase: Timer | null = null;
  private breakTimer: Timer | null = null;
  private spot: BreakSpot | 'sleep' | null = null;
  private idle = true;

  constructor(
    private readonly clock: Clock,
    private readonly timeScale: () => number,
    private readonly hooks: RoutineHooks,
  ) {}

  get onBreak(): boolean {
    return this.spot !== null;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /** Where the bot wants to be while it has no activity. */
  get intent(): Want {
    switch (this.phase) {
      case 'off':
        return 'sleep';
      case 'lunch':
        return 'lunch';
      default:
        return this.spot ?? 'desk';
    }
  }

  /** Dev hook for scripted footage: starts a break at `spot` now (null ends it) and leaves the next one to the usual pacing. */
  forceBreak(spot: BreakSpot | 'sleep' | null, minutes = 0): void {
    this.breakTimer = cancelTimer(this.breakTimer);
    this.spot = spot;
    if (spot !== null && minutes > 0) {
      this.breakTimer = this.after(minutes, () => {
        this.spot = null;
        this.restartBreaksAfterBreak();
        this.hooks.changed();
      });
    } else {
      this.restartBreaksAfterBreak();
    }
    this.hooks.changed();
  }

  /** The day moved on. `immediate` skips the stagger (first value). */
  setPhase(phase: Phase, immediate = false): void {
    this.pendingPhase = cancelTimer(this.pendingPhase);
    if (immediate) {
      this.applyPhase(phase);
      return;
    }
    if (phase === this.phase) return;
    this.pendingPhase = this.after(Math.random() * PHASE_SPREAD_MIN, () => {
      this.pendingPhase = null;
      this.applyPhase(phase);
      this.hooks.changed();
    });
  }

  /** Breaks only run while the bot has no activity. */
  setIdle(idle: boolean): void {
    if (idle === this.idle) return;
    this.idle = idle;
    this.restartBreaks();
  }

  stop(): void {
    this.pendingPhase = cancelTimer(this.pendingPhase);
    this.breakTimer = cancelTimer(this.breakTimer);
  }

  private applyPhase(phase: Phase): void {
    this.phase = phase;
    this.restartBreaks();
  }

  private restartBreaks(): void {
    this.breakTimer = cancelTimer(this.breakTimer);
    this.spot = null;
    if (!this.idle || (this.phase !== 'work' && this.phase !== 'winddown')) return;
    const gap = PACING[this.phase].gap;
    this.breakTimer = this.after(FIRST_GAP_MIN + Math.random() * (between(gap) - FIRST_GAP_MIN), () => this.startBreak());
  }

  private startBreak(): void {
    this.breakTimer = null;
    if (this.phase !== 'work' && this.phase !== 'winddown') return;
    if (!this.hooks.mayBreak()) {
      this.breakTimer = this.after(between(RETRY_MIN), () => this.startBreak());
      return;
    }
    const pacing = PACING[this.phase];
    this.spot = chooseSpot(pacing.weights);
    const length = this.spot === 'cooler' ? COOLER_LENGTH : pacing.length;
    this.breakTimer = this.after(between(length), () => {
      this.spot = null;
      this.restartBreaksAfterBreak();
      this.hooks.changed();
    });
    this.hooks.changed();
  }

  private restartBreaksAfterBreak(): void {
    this.breakTimer = cancelTimer(this.breakTimer);
    if (this.phase !== 'work' && this.phase !== 'winddown') return;
    this.breakTimer = this.after(between(PACING[this.phase].gap), () => this.startBreak());
  }

  private after(minutes: number, run: () => void): Timer {
    return this.clock.after((minutes * 60_000) / Math.max(1, this.timeScale()), run);
  }
}
