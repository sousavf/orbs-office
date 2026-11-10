import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { type CityActivity, appearanceRank, approachPresence, smoothScale } from './density';
import { type Loop, type PathPoint, loopPoint, makeLoop, roadRing } from './loop';
import type { CityPlan } from './plan';

interface Vehicle {
  readonly loop: number;
  readonly offset: number;
  readonly speed: number;
  readonly bus: boolean;
  readonly rank: number;
}

const RING_VEHICLES = [4, 8, 12] as const;
const BUS_SHARE = 8;
const CORNER_RADIUS = 2.6;
const STEP_MS = 100;
const BUS_COLOR = 0xe0b13f;
const COLORS = [0xd9695b, 0xe9c169, 0x70a5a2, 0xf1e9d5, 0x64809d, 0xd99b74, 0x9d8aa8, 0xb4c876, 0xd9bf87, 0x738f9d, 0xb67062, 0xd2d5c4];

/** Instanced cars and buses keep to the right-hand lane of three street rings; the fleet on the road follows the time of day. */
export class ExteriorTraffic {
  readonly meshes: readonly InstancedMesh[];
  private readonly materials = [
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
    new MeshStandardMaterial({ color: 0x748c99, roughness: 0.25 }),
    new MeshBasicMaterial({ color: 0xffe4a0, toneMapped: false }),
    new MeshBasicMaterial({ color: 0xff5147, toneMapped: false }),
    new MeshStandardMaterial({ color: 0x31383b, roughness: 1 }),
  ];
  private readonly matrix = new Matrix4();
  private readonly scaleVector = new Vector3();
  private readonly loops: Loop[] = [];
  private readonly vehicles: Vehicle[] = [];
  private readonly presence: Float32Array;
  private readonly point: PathPoint = { x: 0, z: 0, yaw: 0 };
  private activity: CityActivity = { cars: 1, walkers: 1, buses: true };
  private lastStep = 0;
  private settled = false;

  constructor(plan: CityPlan) {
    for (const inset of [0, plan.step, plan.step * 2]) {
      const ring = roadRing(plan, inset);
      if (ring === null) continue;
      const lane = (half: number): number => half / 2;
      this.loops.push(makeLoop(
        ring.west + lane(ring.halfWest), ring.east - lane(ring.halfEast),
        ring.north + lane(ring.halfNorth), ring.south - lane(ring.halfSouth), CORNER_RADIUS,
      ));
    }
    const total = RING_VEHICLES.slice(0, this.loops.length).reduce((sum, count) => sum + count, 0);
    this.loops.forEach((loop, loopIndex) => {
      const count = RING_VEHICLES[loopIndex] ?? 4;
      for (let ordinal = 0; ordinal < count; ordinal++) {
        const index = this.vehicles.length;
        this.vehicles.push({
          loop: loopIndex,
          offset: loop.length * (ordinal + 0.37 * loopIndex) / count,
          speed: 3.8 + loopIndex * 0.35,
          bus: loopIndex > 0 && index % BUS_SHARE === 3,
          rank: appearanceRank(index, total),
        });
      }
    });
    this.presence = new Float32Array(this.vehicles.length);
    const body = new BoxGeometry(1.55, 0.55, 2.9);
    const glass = new BoxGeometry(1.2, 0.3, 1.45).translate(0, 0.4, 0.05);
    const head = new BoxGeometry(1.15, 0.12, 0.06).translate(0, 0.02, -1.46);
    const tail = new BoxGeometry(1.15, 0.12, 0.06).translate(0, 0.02, 1.46);
    const wheel = new BoxGeometry(1, 1, 1);
    const count = this.vehicles.length;
    this.meshes = [
      new InstancedMesh(body, this.materials[0], count),
      new InstancedMesh(glass, this.materials[1], count),
      new InstancedMesh(head, this.materials[2], count),
      new InstancedMesh(tail, this.materials[3], count),
      new InstancedMesh(wheel, this.materials[4], count * 4),
    ];
    for (const mesh of this.meshes) { mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false; }
    const tint = new Color();
    this.vehicles.forEach((vehicle, index) => this.meshes[0]?.setColorAt(index, tint.setHex(vehicle.bus ? BUS_COLOR : (COLORS[index % COLORS.length] ?? COLORS[0] ?? 0xffffff))));
    this.setActivity(this.activity, true);
    this.write(0);
    this.settled = true;
  }

  /** The share of the fleet that should be on the road; `snap` skips the fade (first sample, reduced motion). */
  setActivity(activity: CityActivity, snap: boolean): void {
    this.activity = activity;
    this.settled = false;
    if (snap) this.vehicles.forEach((vehicle, index) => { this.presence[index] = this.wanted(vehicle) ? 1 : 0; });
  }

  setNight(level: number): void {
    this.materials[2]?.color.setHex(0xffe4a0).multiplyScalar(level);
    this.materials[3]?.color.setHex(0xff5147).multiplyScalar(level);
  }

  update(nowMs: number, reduced: boolean): boolean {
    if (document.hidden) return false;
    if (reduced) {
      if (this.settled) return false;
      this.vehicles.forEach((vehicle, index) => { this.presence[index] = this.wanted(vehicle) ? 1 : 0; });
      this.settled = true;
      this.write(0);
      return true;
    }
    if (nowMs - this.lastStep < STEP_MS) return false;
    const seconds = Math.min(0.5, (nowMs - this.lastStep) / 1000);
    this.lastStep = nowMs;
    let any = false;
    this.vehicles.forEach((vehicle, index) => {
      const next = approachPresence(this.presence[index] ?? 0, this.wanted(vehicle), seconds);
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
    for (const mesh of this.meshes) { mesh.geometry.dispose(); mesh.dispose(); }
    for (const material of this.materials) material.dispose();
  }

  private wanted(vehicle: Vehicle): boolean {
    return vehicle.bus ? this.activity.buses : vehicle.rank < this.activity.cars;
  }

  private write(nowMs: number): void {
    for (let index = 0; index < this.vehicles.length; index++) {
      const vehicle = this.vehicles[index];
      const loop = vehicle === undefined ? undefined : this.loops[vehicle.loop];
      if (vehicle === undefined || loop === undefined) continue;
      const grow = smoothScale(this.presence[index] ?? 0);
      const width = (vehicle.bus ? 1.2 : 1) * grow;
      const height = (vehicle.bus ? 2.1 : 1) * grow;
      const length = (vehicle.bus ? 2.4 : 1) * grow;
      loopPoint(loop, vehicle.offset + nowMs * vehicle.speed / 1000, this.point);
      const { x, z, yaw } = this.point;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      for (let part = 0; part < 4; part++) {
        this.scaleVector.set(width, height, length);
        this.matrix.makeRotationY(yaw).scale(this.scaleVector).setPosition(x, 0.28 * height, z);
        this.meshes[part]?.setMatrixAt(index, this.matrix);
      }
      for (let wheel = 0; wheel < 4; wheel++) {
        const localX = (wheel % 2 === 0 ? -0.78 : 0.78) * width;
        const localZ = (wheel < 2 ? -0.88 : 0.88) * length;
        this.scaleVector.set(0.22 * width, 0.35 * grow, 0.48 * length);
        this.matrix.makeRotationY(yaw).scale(this.scaleVector).setPosition(x + localX * cos + localZ * sin, 0.1 * grow, z - localX * sin + localZ * cos);
        this.meshes[4]?.setMatrixAt(index * 4 + wheel, this.matrix);
      }
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
