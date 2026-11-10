import type { Character } from '../character';
import type { Vec2 } from '../layout.types';

const ARRIVE_EPSILON = 0.02;

/** Walks a character along a list of waypoints at a steady ground speed. */
export class Walker {
  private path: readonly Vec2[] = [];
  private step = 0;
  private speed = 0;

  get active(): boolean {
    return this.path.length > 0;
  }

  /** Starts at waypoint 1 (waypoint 0 is where the character stands). */
  start(path: readonly Vec2[], speed: number): void {
    this.path = path;
    this.step = 1;
    this.speed = speed;
  }

  /** The waypoint being walked toward, or null when idle. */
  get target(): Vec2 | null {
    return this.path[this.step] ?? null;
  }

  stop(): void {
    this.path = [];
    this.step = 0;
  }

  /** Moves the character along the path; returns true on the frame it reaches the end. */
  advance(character: Character, deltaSeconds: number): boolean {
    let budget = this.speed * deltaSeconds;
    while (budget > 0 && this.step < this.path.length) {
      const target = this.path[this.step];
      if (target === undefined) break;
      const dx = target.x - character.x;
      const dz = target.z - character.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= ARRIVE_EPSILON || distance <= budget) {
        character.setPosition(target.x, target.z);
        budget -= distance;
        this.step += 1;
        continue;
      }
      character.setFacing(dx, dz);
      character.setPosition(character.x + (dx / distance) * budget, character.z + (dz / distance) * budget);
      budget = 0;
    }
    if (this.step < this.path.length) return false;
    this.stop();
    return true;
  }
}
