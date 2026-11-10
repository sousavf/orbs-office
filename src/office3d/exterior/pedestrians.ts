import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { type CityActivity, appearanceRank, approachPresence, smoothScale } from './density';
import { type Loop, type PathPoint, loopPoint, makeLoop, roadRing } from './loop';
import type { CityPlan } from './plan';

interface Walker {
  readonly loop: number;
  readonly offset: number;
  readonly speed: number;
  readonly reverse: boolean;
  readonly rank: number;
}

const WALKER_COUNT = 40;
const PAVEMENT_LINE = 0.8;
const CORNER_RADIUS = 0.7;
const STEP_MS = 100;
/** Pavement top in this mesh's local space (the city meshes sit 0.52 below the office floor). */
const PAVEMENT_Y = -0.0825;
const BODY_HEIGHT = 0.75;
const HEAD_SIZE = 0.24;
const COATS = [0x456c74, 0xb25e4e, 0xe1bc66, 0x596987, 0x718a5b, 0x8c6f91];

/** Tiny instanced pedestrians walk the pavements either side of the office's two nearest street rings; how many are out follows the time of day. */
export class ExteriorPedestrians {
  readonly meshes: readonly InstancedMesh[];
  private readonly loops: Loop[] = [];
  private readonly walkers: Walker[] = [];
  private readonly presence = new Float32Array(WALKER_COUNT);
  private readonly point: PathPoint = { x: 0, z: 0, yaw: 0 };
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private activity: CityActivity = { cars: 1, walkers: 1, buses: true };
  private lastStep = 0;
  private settled = false;

  constructor(plan: CityPlan) {
    for (const inset of [0, plan.step]) {
      const ring = roadRing(plan, inset);
      if (ring === null) continue;
      for (const outside of [1, -1]) {
        this.loops.push(makeLoop(
          ring.west - outside * (ring.halfWest + PAVEMENT_LINE), ring.east + outside * (ring.halfEast + PAVEMENT_LINE),
          ring.north - outside * (ring.halfNorth + PAVEMENT_LINE), ring.south + outside * (ring.halfSouth + PAVEMENT_LINE), CORNER_RADIUS,
        ));
      }
    }
    const lengths = this.loops.reduce((sum, loop) => sum + loop.length, 0);
    let index = 0;
    this.loops.forEach((loop, loopIndex) => {
      const count = Math.round(WALKER_COUNT * loop.length / lengths);
      for (let ordinal = 0; ordinal < count && index < WALKER_COUNT; ordinal++, index++) {
        this.walkers.push({
          loop: loopIndex,
          offset: loop.length * (ordinal + 0.5 * (loopIndex % 2)) / count,
          speed: 0.9 + 0.08 * loopIndex,
          reverse: loopIndex % 2 === 1,
          rank: appearanceRank(index, WALKER_COUNT),
        });
      }
    });
    const bodyMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const headMaterial = new MeshStandardMaterial({ color: 0xe0b994, roughness: 0.9 });
    this.meshes = [
      new InstancedMesh(new BoxGeometry(0.28, BODY_HEIGHT, 0.24), bodyMaterial, this.walkers.length),
      new InstancedMesh(new BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE), headMaterial, this.walkers.length),
    ];
    for (const mesh of this.meshes) { mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false; }
    const tint = new Color();
    this.walkers.forEach((_, walker) => this.meshes[0]?.setColorAt(walker, tint.setHex(COATS[walker % COATS.length] ?? 0xffffff)));
    this.setActivity(this.activity, true);
    this.write(0);
    this.settled = true;
  }

  /** The share of the pedestrians who should be out; `snap` skips the fade (first sample, reduced motion). */
  setActivity(activity: CityActivity, snap: boolean): void {
    this.activity = activity;
    this.settled = false;
    if (snap) this.walkers.forEach((walker, index) => { this.presence[index] = walker.rank < activity.walkers ? 1 : 0; });
  }

  update(nowMs: number, reduced: boolean): boolean {
    if (document.hidden) return false;
    if (reduced) {
      if (this.settled) return false;
      this.walkers.forEach((walker, index) => { this.presence[index] = walker.rank < this.activity.walkers ? 1 : 0; });
      this.settled = true;
      this.write(0);
      return true;
    }
    if (nowMs - this.lastStep < STEP_MS) return false;
    const seconds = Math.min(0.5, (nowMs - this.lastStep) / 1000);
    this.lastStep = nowMs;
    let any = false;
    this.walkers.forEach((walker, index) => {
      const next = approachPresence(this.presence[index] ?? 0, walker.rank < this.activity.walkers, seconds);
      this.presence[index] = next;
      any ||= next > 0;
    });
    if (!any) {
      if (this.settled) return false;
      this.settled = true;
    } else this.settled = false;
    this.write(nowMs);
    return true;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) for (const item of material) item.dispose();
      else material.dispose();
      mesh.dispose();
    }
  }

  private write(nowMs: number): void {
    for (let index = 0; index < this.walkers.length; index++) {
      const walker = this.walkers[index];
      const loop = walker === undefined ? undefined : this.loops[walker.loop];
      if (walker === undefined || loop === undefined) continue;
      const grow = smoothScale(this.presence[index] ?? 0);
      const travelled = walker.offset + nowMs * walker.speed / 1000;
      loopPoint(loop, walker.reverse ? loop.length - travelled % loop.length : travelled, this.point);
      const yaw = walker.reverse ? this.point.yaw + Math.PI : this.point.yaw;
      this.scale.set(grow, grow, grow);
      this.matrix.makeRotationY(yaw).scale(this.scale).setPosition(this.point.x, PAVEMENT_Y + BODY_HEIGHT / 2 * grow, this.point.z);
      this.meshes[0]?.setMatrixAt(index, this.matrix);
      this.matrix.makeRotationY(yaw).scale(this.scale).setPosition(this.point.x, PAVEMENT_Y + (BODY_HEIGHT + HEAD_SIZE / 2) * grow, this.point.z);
      this.meshes[1]?.setMatrixAt(index, this.matrix);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
