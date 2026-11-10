import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { DESK_SLOTS, DORM_LAMPS, ISLANDS, POOL, TV } from './layout';
import type { LightGroup } from './lighting-model';
import { matrixAt } from './props/kit';

/** Floor decals sit just above the contact shadows and under the character blobs' render order. */
const FLOOR_Y = 0.05;
const DESK_TOP_Y = 0.746;
const DESK_SIZE = { width: 1.5, depth: 0.8 } as const;

interface StaticPool {
  readonly group: LightGroup;
  readonly x: number;
  readonly z: number;
  /** Radius in metres. */
  readonly radius: number;
  readonly color: number;
  /** Peak strength at full group level. */
  readonly strength: number;
  /** Height above the ground; defaults to the floor. */
  readonly y?: number;
  /** Stretched rectangle instead of a circle, in metres. */
  readonly size?: { readonly width: number; readonly depth: number };
}

const CEILING = 0xffe3bd;
const CEILING_COOL = 0xf4e8d4;
const AMBER = 0xffc48a;

function ring(group: LightGroup, points: readonly (readonly [number, number])[], radius: number, color: number, strength: number): StaticPool[] {
  return points.map(([x, z]) => ({ group, x, z, radius, color, strength }));
}

/** Where the ceiling lights, lamps and glows pool on the floor. The islands and desks come from the layout. */
const STATIC_POOLS: readonly StaticPool[] = [
  ...ISLANDS.map((island): StaticPool => ({ group: 'workspace', x: island.center.x, z: island.center.z, radius: 4.4, color: CEILING, strength: 0.5 })),
  ...ring('workspace', [[28.3, 6]], 3, CEILING, 0.38),
  ...ring('meeting-a', [[3.5, 3]], 3.6, CEILING, 0.5),
  ...ring('meeting-b', [[3.5, 9]], 3.6, CEILING, 0.5),
  ...ring('mailroom', [[3.5, 15]], 3.8, AMBER, 0.5),
  ...ring('approvals', [[10, 15]], 4.2, CEILING_COOL, 0.5),
  ...ring('corridor', [[15, 15]], 3.6, CEILING_COOL, 0.45),
  ...ring('kitchen', [[24.5, 15.7], [24.5, 20.7], [19.5, 19.5]], 4.4, AMBER, 0.52),
  ...ring('hall', [[32, 3], [32, 9.5], [32, 15], [32, 21]], 3.4, AMBER, 0.5),
  ...ring('dormitory', [[38, 4.5], [46, 4.5]], 5, 0xffc890, 0.32),
  ...DORM_LAMPS.map((lamp): StaticPool => ({ group: 'dormNight', x: lamp.position.x, z: lamp.position.z, radius: 1.5, color: 0xff9a52, strength: 0.75 })),
  ...ring('games', [[38, 12], [44.5, 20.5], [38.5, 18.5]], 4.2, 0xffd9b0, 0.42),
  { group: 'poolTable', x: POOL.x, z: POOL.z, radius: 3.2, color: 0xffe0a8, strength: 0.7 },
  {
    group: 'poolTable', x: POOL.x, z: POOL.z, radius: 1.6, color: 0xfff0c8, strength: 0.9, y: POOL.surfaceY + 0.012,
    size: { width: POOL.width - 0.3, depth: POOL.depth - 0.3 },
  },
  { group: 'tv', x: TV.x + 1.6, z: TV.z, radius: 2.4, color: 0x6f9bff, strength: 0.8 },
];

function glowTexture(draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, width: number, height: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    draw(ctx, width, height);
  }
  return new CanvasTexture(canvas);
}

function radial(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, peak: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const stops = 8;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const v = Math.round(255 * peak * (1 - t) ** 2.2);
    gradient.addColorStop(t, `rgb(${v},${v},${v})`);
  }
  ctx.fillStyle = gradient;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function floorTexture(): CanvasTexture {
  return glowTexture((ctx, w, h) => radial(ctx, w / 2, h / 2, w / 2, h / 2, 1), 128, 128);
}

const DESK_PX = 128;

/** The desk top as a texture: the lamp's warm circle near the back-right corner. */
function lampTexture(): CanvasTexture {
  const w = DESK_SIZE.width * DESK_PX;
  const h = DESK_SIZE.depth * DESK_PX;
  return glowTexture((ctx) => radial(ctx, w * 0.793, h * 0.75, 0.62 * DESK_PX, 0.62 * DESK_PX, 1), w, h);
}

/** The desk top as a texture: the monitor's cool spill in front of the screen. */
function monitorTexture(): CanvasTexture {
  const w = DESK_SIZE.width * DESK_PX;
  const h = DESK_SIZE.depth * DESK_PX;
  return glowTexture((ctx) => radial(ctx, w * 0.4, h * 0.42, 0.55 * DESK_PX, 0.4 * DESK_PX, 0.9), w, h);
}

function additiveMaterial(map: CanvasTexture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
}

function flatPlane(): PlaneGeometry {
  return new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
}

function instances(geometry: PlaneGeometry, material: MeshBasicMaterial, matrices: readonly Matrix4[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, matrices.length));
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.count = matrices.length;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.setColorAt(0, new Color(0, 0, 0));
  return mesh;
}

/**
 * Baked-looking light on the floor and desks, drawn as three additive instanced meshes: room pools
 * (ceiling lights, lamps, the TV), warm circles under desk lamps and cool spill from monitors. Real
 * lights are far too few for this, and decals are cheap.
 */
export class LightPools {
  readonly meshes: readonly InstancedMesh[];
  private readonly floor: InstancedMesh;
  private readonly lamp: InstancedMesh;
  private readonly monitor: InstancedMesh;
  private readonly textures: CanvasTexture[];
  private readonly materials: MeshBasicMaterial[];
  private readonly geometry = flatPlane();
  private readonly color = new Color();
  private readonly lastGroups = new Map<number, number>();

  constructor() {
    const floorMap = floorTexture();
    const lampMap = lampTexture();
    const monitorMap = monitorTexture();
    this.textures = [floorMap, lampMap, monitorMap];
    this.materials = this.textures.map(additiveMaterial);
    const [floorMaterial, lampMaterial, monitorMaterial] = this.materials as [MeshBasicMaterial, MeshBasicMaterial, MeshBasicMaterial];
    this.floor = instances(this.geometry, floorMaterial, STATIC_POOLS.map(poolMatrix));
    const deskMatrices = DESK_SLOTS.map((slot) =>
      matrixAt(slot.desk.x, DESK_TOP_Y, slot.desk.z, slot.deskRotY).multiply(
        new Matrix4().makeScale(DESK_SIZE.width * slot.scale, 1, DESK_SIZE.depth * slot.scale),
      ),
    );
    this.lamp = instances(this.geometry, lampMaterial, deskMatrices);
    this.monitor = instances(this.geometry, monitorMaterial, deskMatrices);
    this.meshes = [this.floor, this.lamp, this.monitor];
    this.setGroups(Object.fromEntries(STATIC_POOLS.map((pool) => [pool.group, 0])) as Record<LightGroup, number>);
    this.setDesks(DESK_SLOTS.map(() => 0), DESK_SLOTS.map(() => 0));
  }

  /** Paints each room pool at its group's level; returns true when anything changed. */
  setGroups(levels: Readonly<Record<LightGroup, number>>): boolean {
    let changed = false;
    STATIC_POOLS.forEach((pool, index) => {
      const level = Math.round((levels[pool.group] ?? 0) * pool.strength * 200) / 200;
      if (this.lastGroups.get(index) === level) return;
      this.lastGroups.set(index, level);
      this.floor.setColorAt(index, this.color.setHex(pool.color).multiplyScalar(level));
      changed = true;
    });
    if (changed && this.floor.instanceColor) this.floor.instanceColor.needsUpdate = true;
    this.floor.visible = [...this.lastGroups.values()].some((level) => level > 0);
    return changed;
  }

  /** Sets every desk's lamp and monitor glow (0 to 1). */
  setDesks(lamps: readonly number[], monitors: readonly number[]): void {
    const warm = new Color(0xffd08a);
    const cool = new Color(0x7fb0ff);
    DESK_SLOTS.forEach((_, id) => {
      this.lamp.setColorAt(id, this.color.copy(warm).multiplyScalar(0.85 * (lamps[id] ?? 0)));
      this.monitor.setColorAt(id, this.color.copy(cool).multiplyScalar(0.8 * (monitors[id] ?? 0)));
    });
    for (const mesh of [this.lamp, this.monitor]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.lamp.visible = lamps.some((level) => level > 0);
    this.monitor.visible = monitors.some((level) => level > 0);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}

function poolMatrix(pool: StaticPool): Matrix4 {
  const size = pool.size ?? { width: pool.radius * 2, depth: pool.radius * 2 };
  return new Matrix4().compose(new Vector3(pool.x, pool.y ?? FLOOR_Y, pool.z), new Quaternion(), new Vector3(size.width, 1, size.depth));
}
