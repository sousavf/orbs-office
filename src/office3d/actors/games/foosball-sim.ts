import { FOOSBALL } from '../../layout';
import type { FoosballRig } from '../../rigs/games-rig';

const HALF_LENGTH = FOOSBALL.width / 2 - 0.1;
const HALF_WIDTH = FOOSBALL.depth / 2 - 0.1;
const BALL_SPEED = 1.5;
const GOAL_EVERY: readonly [number, number] = [9, 18];

export type FoosEvent = 'goal' | 'near';

/** A rally on the table football: the ball runs between random points, the rods slide and twist to meet it, and now and then it ends in a goal. */
export class FoosballSim {
  private time = 0;
  private x: number = FOOSBALL.x;
  private z: number = FOOSBALL.z;
  private targetX: number = FOOSBALL.x;
  private targetZ: number = FOOSBALL.z;
  private goalAt = 0;
  private pause = 0;

  constructor(
    private readonly rig: FoosballRig,
    private readonly emit: (event: FoosEvent) => void,
  ) {
    this.reset();
  }

  reset(): void {
    this.time = 0;
    this.x = FOOSBALL.x;
    this.z = FOOSBALL.z;
    this.pickTarget();
    this.goalAt = GOAL_EVERY[0] + Math.random() * (GOAL_EVERY[1] - GOAL_EVERY[0]);
    this.rig.setBall(this.x, this.z);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) this.reset();
    } else {
      const dx = this.targetX - this.x;
      const dz = this.targetZ - this.z;
      const distance = Math.hypot(dx, dz);
      const move = BALL_SPEED * dt;
      if (distance <= move) {
        this.x = this.targetX;
        this.z = this.targetZ;
        this.pickTarget();
      } else {
        this.x += (dx / distance) * move;
        this.z += (dz / distance) * move;
      }
      this.rig.setBall(this.x, this.z);
      if (this.time >= this.goalAt) {
        this.targetX = (Math.random() < 0.5 ? -1 : 1) * HALF_LENGTH + FOOSBALL.x;
        this.goalAt = Number.POSITIVE_INFINITY;
        this.pause = 1.1;
        this.emit('goal');
      }
    }
    this.moveRods();
  }

  private pickTarget(): void {
    this.targetX = FOOSBALL.x + (Math.random() * 2 - 1) * HALF_LENGTH;
    this.targetZ = FOOSBALL.z + (Math.random() * 2 - 1) * HALF_WIDTH;
    if (Math.random() < 0.12) this.emit('near');
  }

  private moveRods(): void {
    for (const rod of this.rig.rods) {
      const near = Math.abs(rod.x - this.x) < 0.22;
      const swing = near ? 1.1 : 0.35;
      rod.setTwist(Math.sin(this.time * (4 + rod.index * 0.6) + rod.index) * swing);
      const follow = Math.max(-0.12, Math.min(0.12, (this.z - FOOSBALL.z) * 0.7));
      rod.setSlide(near ? follow : follow * 0.4 + Math.sin(this.time * 0.9 + rod.index * 1.7) * 0.04);
    }
  }
}
