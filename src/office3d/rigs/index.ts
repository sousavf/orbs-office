import type { Materials } from '../materials';
import { GamesRig } from './games-rig';
import { IslandSigns } from './island-signs';
import { LunchTrays } from './lunch-trays';
import { SleepRig } from './sleep-rig';

export { ConsoleScreen, FoosRod, FoosballRig, GamesRig, POOL_BALL_COUNT, PoolBalls } from './games-rig';
export type { ScreenMode } from './games-rig';
export { IslandSigns } from './island-signs';
export { FOOD_COLORS, LunchTrays } from './lunch-trays';
export { type Sleeper, SleepRig } from './sleep-rig';

/** Everything in the world that changes after it is built, each behind a small typed API. */
export class WorldRigs {
  readonly games: GamesRig;
  readonly sleep: SleepRig;
  readonly trays: LunchTrays;
  readonly islands: IslandSigns;

  constructor(materials: Materials) {
    this.games = new GamesRig(materials);
    this.sleep = new SleepRig(materials);
    this.trays = new LunchTrays(materials);
    this.islands = new IslandSigns(materials);
  }

  get groups(): readonly import('three').Group[] {
    return [this.games.group, this.sleep.group, this.trays.group, this.islands.group];
  }

  setReducedMotion(reduced: boolean): void {
    this.games.setReducedMotion(reduced);
    this.sleep.setReducedMotion(reduced);
  }

  /** Advances breathing, the TV and the foosball rods; returns true when the picture changed. */
  update(deltaSeconds: number): boolean {
    const games = this.games.update(deltaSeconds);
    const sleep = this.sleep.update(deltaSeconds);
    return games || sleep;
  }

  dispose(): void {
    this.games.dispose();
    this.sleep.dispose();
    this.islands.dispose();
  }
}
