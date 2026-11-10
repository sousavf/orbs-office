import { Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import type { Daylight } from '../daylight';
import { cityActivity } from './density';
import type { LightLevels } from '../lighting-model';
import { ExteriorBatch } from './batch';
import { buildBlocks } from './blocks';
import { ExteriorEffects } from './effects';
import { ExteriorGround } from './ground';
import { makeCityPlan } from './plan';
import { ExteriorPedestrians } from './pedestrians';
import { buildStreets } from './streets';
import { ExteriorTraffic } from './traffic';

/** Ambient lighting serves the office; the exterior needs its own night attenuation. */
const NIGHT_SURFACE_LEVEL = 0.3;
const ACTIVITY_INTERVAL_MS = 500;

/** Decorative, non-walkable city shared by the private and public scenes. */
export class Exterior {
  readonly group = new Group();
  private readonly ground = new ExteriorGround();
  private readonly content = new Group();
  private readonly material = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.93 });
  private readonly windowMaterial = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  private readonly daylightWindowColor = new Color(0x8cb0c6);
  private effects: ExteriorEffects | null = null;
  private traffic: ExteriorTraffic | null = null;
  private pedestrians: ExteriorPedestrians | null = null;
  private staticMeshes: Mesh[] = [];
  private builtExtent = 0;
  private lastDayFactor = 1;
  private lastLampFactor = 0;
  private clock: (() => Date) | null = null;
  private lastSample = Number.NEGATIVE_INFINITY;
  private reducedMotion = false;

  constructor() {
    this.group.add(this.ground.mesh, this.content);
    this.rebuild(180);
  }

  setExtent(halfExtent: number): void {
    this.ground.setExtent(halfExtent);
    if (halfExtent > this.builtExtent) this.rebuild(halfExtent);
  }

  setLighting(levels: LightLevels, daylight: Daylight): void {
    this.ground.setLighting(levels, daylight);
    this.lastDayFactor = daylight.dayFactor;
    this.lastLampFactor = daylight.lampFactor;
    this.applyNight();
  }

  /** The office clock the traffic and pavements follow (the same one the schedule and lighting read). */
  setClock(clock: () => Date): void {
    this.clock = clock;
    this.sampleActivity(0, this.reducedMotion, true);
  }

  update(nowMs: number, reduced: boolean): boolean {
    this.reducedMotion = reduced;
    this.sampleActivity(nowMs, reduced);
    const cars = this.traffic?.update(nowMs, reduced) ?? false;
    const walkers = this.pedestrians?.update(nowMs, reduced) ?? false;
    return cars || walkers;
  }

  dispose(): void {
    this.disposeContent();
    this.ground.dispose();
    this.material.dispose();
    this.windowMaterial.dispose();
  }

  /** Twice a second is plenty for a curve that moves over hours; nothing allocates while the clock is unset. */
  private sampleActivity(nowMs: number, reduced: boolean, snap = false): void {
    if (this.clock === null || (!snap && nowMs - this.lastSample < ACTIVITY_INTERVAL_MS)) return;
    this.lastSample = nowMs;
    const date = this.clock();
    const activity = cityActivity(date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60, date.getDay());
    this.traffic?.setActivity(activity, snap || reduced);
    this.pedestrians?.setActivity(activity, snap || reduced);
  }

  private rebuild(halfExtent: number): void {
    const plan = makeCityPlan(halfExtent);
    const roadSolid = new ExteriorBatch();
    const roadLit = new ExteriorBatch();
    const blockSolid = new ExteriorBatch();
    const blockLit = new ExteriorBatch();
    const street = buildStreets(plan, roadSolid, roadLit);
    const blocks = buildBlocks(plan, blockSolid, blockLit);
    const streetMesh = roadSolid.build(this.material);
    const streetLights = roadLit.build(this.windowMaterial);
    const blockMesh = blockSolid.build(this.material);
    const blockWindows = blockLit.build(this.windowMaterial);
    blockMesh.position.y = -0.52;
    blockWindows.position.y = -0.52;
    this.disposeContent();
    this.staticMeshes = [streetMesh, streetLights, blockMesh, blockWindows];
    this.effects = new ExteriorEffects(street.lamps, blocks.shadows);
    this.traffic = new ExteriorTraffic(plan);
    this.pedestrians = new ExteriorPedestrians(plan);
    for (const mesh of [...this.traffic.meshes, ...this.pedestrians.meshes]) mesh.position.y = -0.52;
    this.content.add(...this.staticMeshes, this.effects.group, ...this.traffic.meshes, ...this.pedestrians.meshes);
    this.builtExtent = halfExtent;
    this.applyNight();
    this.sampleActivity(0, this.reducedMotion, true);
  }

  private applyNight(): void {
    this.material.color.setScalar(NIGHT_SURFACE_LEVEL + (1 - NIGHT_SURFACE_LEVEL) * this.lastDayFactor);
    this.windowMaterial.color.setHex(0xffd5a4).lerp(this.daylightWindowColor, this.lastDayFactor).multiplyScalar(0.75 + 0.25 * this.lastDayFactor);
    this.traffic?.setNight(this.lastLampFactor);
    this.effects?.setNight(this.lastLampFactor, this.lastDayFactor);
  }

  private disposeContent(): void {
    this.content.clear();
    for (const mesh of this.staticMeshes) mesh.geometry.dispose();
    this.staticMeshes = [];
    this.effects?.dispose();
    this.effects = null;
    this.traffic?.dispose();
    this.traffic = null;
    this.pedestrians?.dispose();
    this.pedestrians = null;
  }
}
