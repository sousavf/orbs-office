import {
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
  type BufferGeometry,
  type Texture,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BEDS } from '../layout';
import type { Bed, Vec3 } from '../layout.types';
import type { Materials } from '../materials';

/** Who sleeps in a bed: the blanket takes `color`, the pillow shows `headTexture` (or a plain head). */
export interface Sleeper {
  readonly color: number;
  readonly headTexture: Texture | null;
}

/** Breathing runs at this rate; the rig asks for a redraw only when it steps. */
const BREATH_HZ = 12;
const BREATH_RATE = 1.5;
const BREATH_DEPTH = 0.07;
const HEAD_RADIUS = 0.21;
const PILLOW = { width: 0.64, height: 0.11, depth: 0.42, z: -0.66 } as const;
/** How long a blanket, pillow and head take to appear or go while the figure fades the other way. */
export const SLEEP_FADE_MS = 400;
const SKIN = 0xf4dfcb;
const HAIR = 0x5a4636;

function blanketGeometry(): BufferGeometry {
  const slab = new RoundedBoxGeometry(0.88, 0.07, 1.2, 1, 0.03).translate(0, 0.035, 0.27);
  const chest = new SphereGeometry(0.5, 14, 8).scale(0.66, 0.26, 0.84).translate(0, 0.06, -0.02).toNonIndexed();
  const legs = new SphereGeometry(0.5, 12, 8).scale(0.52, 0.17, 0.98).translate(0, 0.05, 0.55).toNonIndexed();
  return mergeGeometries([slab, chest, legs], false);
}

/** World offset of a bed-local (x, z) offset, for a bed turned by `yaw` (the same turn as Matrix4.makeRotationY). */
function offsetOf(bed: Bed, lx: number, lz: number): { x: number; z: number } {
  const cos = Math.cos(bed.yaw);
  const sin = Math.sin(bed.yaw);
  return { x: bed.position.x + lx * cos + lz * sin, z: bed.position.z - lx * sin + lz * cos };
}

interface HeadDisc {
  readonly group: Group;
  readonly skin: MeshStandardMaterial;
  readonly hair: Object3D;
}

/**
 * Sleepers for the dormitory: sprites cannot lie down, so a bed gets a tinted blanket, a pillow and a flat
 * head disc instead. Each bed shows or hides on its own; the blanket rises and falls gently.
 */
export class SleepRig {
  readonly group = new Group();
  private readonly beds = new Map<string, number>();
  private readonly blankets: InstancedMesh;
  private readonly pillows: InstancedMesh;
  private readonly heads = new Map<string, HeadDisc>();
  private readonly sleepers = new Map<string, Sleeper>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly headGeometry = new CircleGeometry(HEAD_RADIUS, 20);
  private readonly hairGeometry = new CircleGeometry(HEAD_RADIUS * 0.99, 20, 0.05, Math.PI * 1.05);
  private readonly hairMaterial = new MeshStandardMaterial({ color: HAIR, roughness: 0.9 });
  private readonly scratch = new Matrix4();
  private readonly breathScale = new Vector3(1, 1, 1);
  /** Beds whose blanket is growing in (target 1) or out (target 0); absent means fully shown. */
  private readonly levels = new Map<string, { value: number; target: number }>();
  private clock = 0;
  private lastStep = -1;
  private reduced = false;

  constructor(materials: Materials) {
    BEDS.forEach((bed, index) => this.beds.set(bed.id, index));
    const blanketGeo = blanketGeometry();
    const pillowGeo = new RoundedBoxGeometry(PILLOW.width, PILLOW.height, PILLOW.depth, 2, 0.04).translate(0, PILLOW.height / 2, 0);
    this.geometries.push(blanketGeo, pillowGeo, this.headGeometry, this.hairGeometry);
    this.blankets = new InstancedMesh(blanketGeo, materials.get('tint'), BEDS.length);
    this.pillows = new InstancedMesh(pillowGeo, materials.get('pillow'), BEDS.length);
    this.blankets.instanceMatrix.setUsage(DynamicDrawUsage);
    for (const mesh of [this.blankets, this.pillows]) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    const hidden = new Matrix4().makeScale(0, 0, 0);
    const base = new Color(0xffffff);
    BEDS.forEach((_, index) => {
      this.blankets.setMatrixAt(index, hidden);
      this.pillows.setMatrixAt(index, hidden);
      this.blankets.setColorAt(index, base);
    });
  }

  /** Puts a sleeper in a bed, or empties it with `null`; `fadeMs` eases the blanket, pillow and head in or out. Unknown bed ids are ignored. */
  setSleeper(bedId: string, sleeper: Sleeper | null, fadeMs = 0): void {
    const index = this.beds.get(bedId);
    const bed = BEDS[index ?? -1];
    if (index === undefined || bed === undefined) return;
    const animate = fadeMs > 0 && !this.reduced;
    if (sleeper === null) {
      if (animate && this.sleepers.has(bedId)) {
        this.levels.set(bedId, { value: this.levels.get(bedId)?.value ?? 1, target: 0 });
        return;
      }
      this.clearBed(bedId, index);
    } else {
      this.sleepers.set(bedId, sleeper);
      this.blankets.setColorAt(index, new Color(sleeper.color));
      if (animate) this.levels.set(bedId, { value: this.levels.get(bedId)?.value ?? 0, target: 1 });
      else this.levels.delete(bedId);
      this.writeBed(index, bed, 1);
      this.showHead(bed, sleeper);
    }
    this.blankets.instanceMatrix.needsUpdate = true;
    this.pillows.instanceMatrix.needsUpdate = true;
    if (this.blankets.instanceColor) this.blankets.instanceColor.needsUpdate = true;
  }

  private clearBed(bedId: string, index: number): void {
    this.sleepers.delete(bedId);
    this.levels.delete(bedId);
    this.scratch.makeScale(0, 0, 0);
    this.blankets.setMatrixAt(index, this.scratch);
    this.pillows.setMatrixAt(index, this.scratch);
    const head = this.heads.get(bedId);
    if (head !== undefined) head.group.visible = false;
  }

  isOccupied(bedId: string): boolean {
    return this.sleepers.has(bedId);
  }

  get occupied(): number {
    return this.sleepers.size;
  }

  /** Where the sleeper's head rests; anchor "Zzz" overlays a little above it. */
  headAnchor(bedId: string): Vec3 | null {
    const index = this.beds.get(bedId);
    return BEDS[index ?? -1]?.head ?? null;
  }

  setReducedMotion(reduced: boolean): void {
    if (reduced === this.reduced) return;
    this.reduced = reduced;
    if (reduced) this.rewrite(1);
  }

  /** Advances breathing; returns true when the blankets moved and the scene needs a redraw. */
  update(deltaSeconds: number): boolean {
    if (this.reduced || this.sleepers.size === 0) return false;
    this.clock += deltaSeconds;
    const fading = this.advanceLevels(deltaSeconds);
    const step = Math.floor(this.clock * BREATH_HZ);
    if (step === this.lastStep && !fading) return false;
    this.lastStep = step;
    this.rewrite(null);
    return true;
  }

  private advanceLevels(deltaSeconds: number): boolean {
    if (this.levels.size === 0) return false;
    for (const [bedId, level] of [...this.levels]) {
      const move = (deltaSeconds * 1000) / SLEEP_FADE_MS;
      level.value = level.target > level.value ? Math.min(level.target, level.value + move) : Math.max(level.target, level.value - move);
      if (level.value !== level.target) continue;
      this.levels.delete(bedId);
      const index = this.beds.get(bedId);
      if (level.target === 0 && index !== undefined) this.clearBed(bedId, index);
    }
    this.pillows.instanceMatrix.needsUpdate = true;
    return true;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.blankets.dispose();
    this.pillows.dispose();
    for (const head of this.heads.values()) head.skin.dispose();
    this.hairMaterial.dispose();
  }

  private rewrite(scale: number | null): void {
    BEDS.forEach((bed, index) => {
      if (!this.sleepers.has(bed.id)) return;
      this.writeBed(index, bed, scale ?? 1 + BREATH_DEPTH * Math.sin(this.clock * BREATH_RATE * Math.PI * 2 + index * 1.7));
    });
    this.blankets.instanceMatrix.needsUpdate = true;
  }

  /** Blanket and pillow for a bed; while one fades they grow from (or shrink to) the bed, and so does the head disc. */
  private writeBed(index: number, bed: Bed, breath: number): void {
    const raw = this.levels.get(bed.id)?.value ?? 1;
    const level = Math.max(0.001, raw * raw * (3 - 2 * raw));
    this.scratch
      .makeRotationY(bed.yaw)
      .scale(this.breathScale.set(level, breath * level, level))
      .setPosition(bed.position.x, bed.position.y, bed.position.z);
    this.blankets.setMatrixAt(index, this.scratch);
    const pillow = offsetOf(bed, 0, PILLOW.z);
    this.pillows.setMatrixAt(index, this.scratch.makeRotationY(bed.yaw).scale(this.breathScale.set(level, level, level)).setPosition(pillow.x, bed.position.y, pillow.z));
    const head = this.heads.get(bed.id);
    head?.group.scale.set(level, 1, level);
  }

  private showHead(bed: Bed, sleeper: Sleeper): void {
    let head = this.heads.get(bed.id);
    if (head === undefined) {
      head = this.createHead(bed);
      this.heads.set(bed.id, head);
    }
    head.skin.map = sleeper.headTexture;
    head.skin.color.setHex(sleeper.headTexture === null ? SKIN : 0xffffff);
    head.skin.needsUpdate = true;
    head.hair.visible = sleeper.headTexture === null;
    head.group.visible = true;
  }

  private createHead(bed: Bed): HeadDisc {
    const skin = new MeshStandardMaterial({ color: SKIN, roughness: 0.9 });
    const group = new Group();
    const face = new Mesh(this.headGeometry, skin);
    const hair = new Mesh(this.hairGeometry, this.hairMaterial);
    hair.position.z = 0.002;
    face.rotation.x = -Math.PI / 2;
    face.receiveShadow = true;
    hair.receiveShadow = true;
    const pivot = new Group();
    pivot.rotation.x = -Math.PI / 2;
    pivot.add(hair);
    group.add(face, pivot);
    const spot = offsetOf(bed, 0, PILLOW.z);
    group.position.set(spot.x, bed.position.y + PILLOW.height + 0.006, spot.z);
    group.rotation.y = bed.yaw;
    group.visible = false;
    this.group.add(group);
    return { group, skin, hair: pivot };
  }
}
