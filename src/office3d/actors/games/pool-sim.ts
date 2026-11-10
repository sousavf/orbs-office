import { POOL } from '../../layout';
import type { Vec2 } from '../../layout.types';
import type { PoolBalls } from '../../rigs/games-rig';

const RADIUS = 0.04;
const FRICTION = 0.55;
const RESTITUTION = 0.8;
const STOP_SPEED = 0.03;
const POCKET_RADIUS = 0.11;
const STEP = 1 / 120;
const AIM_SECONDS = 1.8;
const REST_SECONDS = 1.3;
const MAX_ROLL_SECONDS = 8;
const RERACK_BELOW = 4;
const AIM_NOISE = 0.28;
const SPEED_RANGE: readonly [number, number] = [1.3, 2.7];

type Phase = 'aim' | 'roll' | 'rest';

interface Ball {
  x: number;
  z: number;
  vx: number;
  vz: number;
  alive: boolean;
}

export type PoolEvent = 'pot' | 'miss' | 'rerack';

/**
 * A believable game on the pool rig: players take turns, the cue ball is struck at a random object ball
 * with some error, balls roll, bounce off the rails, knock each other, slow down and stop; now and then
 * one drops into a pocket. The table is re-racked when few balls remain.
 */
export class PoolSim {
  /** Whose turn it is: 0 or 1. */
  turn = 0;
  phase: Phase = 'aim';
  private time = 0;
  private rolled = 0;
  private potted = 0;
  private readonly balls: Ball[] = [];
  private readonly pockets: Vec2[];

  constructor(
    private readonly rig: PoolBalls,
    private readonly emit: (event: PoolEvent, shooter: number) => void,
  ) {
    const { x0, x1, z0, z1 } = rig.bounds;
    const mid = (x0 + x1) / 2;
    this.pockets = [
      { x: x0, z: z0 }, { x: mid, z: z0 }, { x: x1, z: z0 },
      { x: x0, z: z1 }, { x: mid, z: z1 }, { x: x1, z: z1 },
    ];
    this.reset();
  }

  reset(): void {
    this.rig.rack();
    this.balls.length = 0;
    for (let i = 0; i < this.rig.count; i += 1) {
      const p = this.rig.position(i) ?? { x: POOL.x, z: POOL.z };
      this.balls.push({ x: p.x, z: p.z, vx: 0, vz: 0, alive: true });
    }
    this.phase = 'aim';
    this.time = 0;
  }

  /** Advances the game; returns true while balls moved. */
  update(dt: number): boolean {
    this.time += dt;
    if (this.phase === 'aim') {
      if (this.time >= AIM_SECONDS) this.strike();
      return false;
    }
    if (this.phase === 'rest') {
      if (this.time >= REST_SECONDS) this.nextTurn();
      return false;
    }
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(STEP, remaining);
      this.integrate(step);
      remaining -= step;
    }
    this.rolled += dt;
    this.flush();
    if (this.rolled >= MAX_ROLL_SECONDS || this.balls.every((b) => !b.alive || Math.hypot(b.vx, b.vz) < STOP_SPEED)) {
      for (const b of this.balls) {
        b.vx = 0;
        b.vz = 0;
      }
      this.phase = 'rest';
      this.time = 0;
      if (this.potted === 0) this.emit('miss', this.turn);
    }
    return true;
  }

  private strike(): void {
    const cue = this.balls[0];
    if (cue === undefined) return;
    if (!cue.alive) this.respawnCue(cue);
    const targets = this.balls.slice(1).filter((b) => b.alive);
    const target = targets[Math.floor(Math.random() * targets.length)];
    const base = target === undefined ? Math.random() * Math.PI * 2 : Math.atan2(target.z - cue.z, target.x - cue.x);
    const angle = base + (Math.random() - 0.5) * 2 * AIM_NOISE;
    const speed = SPEED_RANGE[0] + Math.random() * (SPEED_RANGE[1] - SPEED_RANGE[0]);
    cue.vx = Math.cos(angle) * speed;
    cue.vz = Math.sin(angle) * speed;
    this.phase = 'roll';
    this.rolled = 0;
    this.potted = 0;
  }

  private nextTurn(): void {
    this.turn = 1 - this.turn;
    this.phase = 'aim';
    this.time = 0;
    const cue = this.balls[0];
    if (cue !== undefined && !cue.alive) this.respawnCue(cue);
    if (this.balls.slice(1).filter((b) => b.alive).length < RERACK_BELOW) {
      this.reset();
      this.emit('rerack', this.turn);
    }
  }

  private respawnCue(cue: Ball): void {
    cue.alive = true;
    cue.x = POOL.x - POOL.width * 0.25;
    cue.z = POOL.z;
    cue.vx = 0;
    cue.vz = 0;
    this.rig.setVisible(0, true);
    this.rig.setBall(0, cue.x, cue.z);
  }

  private integrate(dt: number): void {
    const { x0, x1, z0, z1 } = this.rig.bounds;
    for (const b of this.balls) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const speed = Math.hypot(b.vx, b.vz);
      if (speed > 0) {
        const next = Math.max(0, speed - FRICTION * dt);
        b.vx *= next / speed;
        b.vz *= next / speed;
      }
      if (b.x < x0 || b.x > x1) {
        b.x = Math.min(x1, Math.max(x0, b.x));
        b.vx = -b.vx * RESTITUTION;
      }
      if (b.z < z0 || b.z > z1) {
        b.z = Math.min(z1, Math.max(z0, b.z));
        b.vz = -b.vz * RESTITUTION;
      }
    }
    for (let i = 0; i < this.balls.length; i += 1) {
      const a = this.balls[i];
      if (a === undefined || !a.alive) continue;
      for (let j = i + 1; j < this.balls.length; j += 1) {
        const b = this.balls[j];
        if (b === undefined || !b.alive) continue;
        this.collide(a, b);
      }
    }
    this.balls.forEach((b, index) => {
      if (!b.alive) return;
      if (!this.pockets.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < POCKET_RADIUS)) return;
      b.alive = false;
      b.vx = 0;
      b.vz = 0;
      this.rig.setVisible(index, false);
      if (index !== 0) {
        this.potted += 1;
        this.emit('pot', this.turn);
      }
    });
  }

  private collide(a: Ball, b: Ball): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= RADIUS * 2 || distance < 1e-6) return;
    const nx = dx / distance;
    const nz = dz / distance;
    const overlap = RADIUS * 2 - distance;
    a.x -= nx * overlap * 0.5;
    a.z -= nz * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.z += nz * overlap * 0.5;
    const along = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (along <= 0) return;
    a.vx -= along * nx;
    a.vz -= along * nz;
    b.vx += along * nx;
    b.vz += along * nz;
  }

  private flush(): void {
    this.balls.forEach((b, index) => {
      if (b.alive && (b.vx !== 0 || b.vz !== 0)) this.rig.setBall(index, b.x, b.z);
    });
  }
}
