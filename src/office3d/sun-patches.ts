import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { Vec3 } from './daylight';
import { ROOMS, WALL_DECOR, zoneAt } from './layout';
import type { Rect, WallDecor } from './layout.types';

/** Where the decor placer puts a window's pane, relative to the wall line. */
const PANE_INSET = 0.095;
const FLOOR_Y = 0.06;
const WALL_HALF = 0.075;
/** Light through curtains and shutters is weaker. */
const VARIANT_STRENGTH: readonly number[] = [1, 0.4, 0.5];
const MAX_POLYGON_VERTICES = 10;

interface Corner {
  x: number;
  z: number;
  u: number;
  v: number;
}

interface PatchWindow {
  readonly decor: WallDecor;
  readonly room: Rect;
  readonly strength: number;
}

function windows(): PatchWindow[] {
  const list: PatchWindow[] = [];
  for (const decor of WALL_DECOR) {
    if (decor.kind !== 'window') continue;
    // Only windows with the open air behind them let the sun in.
    if (zoneAt(decor.x - decor.nx * 0.3, decor.z - decor.nz * 0.3) !== 'outside') continue;
    const zone = zoneAt(decor.x + decor.nx * 0.5, decor.z + decor.nz * 0.5);
    const room = ROOMS.find((candidate) => candidate.id === zone)?.rect;
    if (room === undefined) continue;
    list.push({ decor, room, strength: VARIANT_STRENGTH[decor.variant] ?? 1 });
  }
  return list;
}

/** Sutherland-Hodgman clip of a convex polygon against one axis-aligned half plane, carrying the texture coordinates. */
function clipEdge(polygon: readonly Corner[], axis: 'x' | 'z', limit: number, keepAbove: boolean): Corner[] {
  const out: Corner[] = [];
  const inside = (corner: Corner): boolean => (keepAbove ? corner[axis] >= limit : corner[axis] <= limit);
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    if (previous === undefined) return;
    if (inside(current) !== inside(previous)) {
      const t = (limit - previous[axis]) / (current[axis] - previous[axis]);
      out.push({
        x: previous.x + (current.x - previous.x) * t,
        z: previous.z + (current.z - previous.z) * t,
        u: previous.u + (current.u - previous.u) * t,
        v: previous.v + (current.v - previous.v) * t,
      });
    }
    if (inside(current)) out.push(current);
  });
  return out;
}

function clipToRoom(polygon: Corner[], room: Rect): Corner[] {
  let result = polygon;
  result = clipEdge(result, 'x', room.x0 + WALL_HALF, true);
  result = clipEdge(result, 'x', room.x1 - WALL_HALF, false);
  result = clipEdge(result, 'z', room.z0 + WALL_HALF, true);
  result = clipEdge(result, 'z', room.z1 - WALL_HALF, false);
  return result;
}

/** A pane of soft-edged sunlight divided by the window's cross mullion. */
function patchTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    const image = ctx.createImageData(size, size);
    const edge = (t: number): number => {
      const d = Math.min(t, 1 - t);
      const k = Math.min(1, Math.max(0, d / 0.14));
      return k * k * (3 - 2 * k);
    };
    const bar = (t: number, half: number): number => {
      const k = Math.min(1, Math.max(0, (Math.abs(t - 0.5) - half) / 0.025));
      return k * k * (3 - 2 * k);
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        const value = edge(u) * edge(v) * Math.min(1, 0.35 + 0.65 * bar(u, 0.025) * bar(v, 0.025));
        const byte = Math.round(255 * value);
        const o = (y * size + x) * 4;
        image.data[o] = byte;
        image.data[o + 1] = byte;
        image.data[o + 2] = byte;
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  return new CanvasTexture(canvas);
}

/**
 * Sunlight on the floor through each window facing the sun: the pane projected along the sun's rays,
 * clipped to its room and drawn as additive soft-edged quads. One mesh, rebuilt when the sun moves.
 */
export class SunPatches {
  readonly mesh: Mesh;
  private readonly list = windows();
  private readonly positions: BufferAttribute;
  private readonly uvs: BufferAttribute;
  private readonly colors: BufferAttribute;
  private readonly index: BufferAttribute;
  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  private readonly texture = patchTexture();

  constructor() {
    const capacity = this.list.length * MAX_POLYGON_VERTICES;
    this.positions = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.uvs = new BufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage);
    this.colors = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.index = new BufferAttribute(new Uint16Array(this.list.length * (MAX_POLYGON_VERTICES - 2) * 3), 1).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('uv', this.uvs);
    this.geometry.setAttribute('color', this.colors);
    this.geometry.setIndex(this.index);
    this.geometry.setDrawRange(0, 0);
    this.material = new MeshBasicMaterial({
      map: this.texture,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** Number of windows that let the sun in right now (for diagnostics). */
  litWindows = 0;

  /**
   * Rebuilds the patches for a sun direction (unit vector toward the sun); `color` is the sunlight
   * colour already scaled by how strongly it shines. Returns true when the geometry changed.
   */
  update(sunDir: Vec3, color: Color): boolean {
    this.material.color.copy(color);
    const visible = sunDir.y > 0.02 && color.r + color.g + color.b > 0.01;
    this.mesh.visible = visible;
    if (!visible) {
      this.litWindows = 0;
      return false;
    }
    let vertices = 0;
    let indices = 0;
    let lit = 0;
    for (const window of this.list) {
      const { decor } = window;
      // Light enters only when the sun is on the outside of the wall.
      if (sunDir.x * decor.nx + sunDir.z * decor.nz >= -0.02) continue;
      const polygon = this.project(window, sunDir);
      if (polygon.length < 3) continue;
      lit++;
      const base = vertices;
      for (const corner of polygon) {
        this.positions.setXYZ(vertices, corner.x, FLOOR_Y, corner.z);
        this.uvs.setXY(vertices, corner.u, corner.v);
        this.colors.setXYZ(vertices, window.strength, window.strength, window.strength);
        vertices++;
      }
      for (let i = 1; i + 1 < polygon.length; i++) {
        this.index.setX(indices++, base);
        this.index.setX(indices++, base + i);
        this.index.setX(indices++, base + i + 1);
      }
    }
    this.litWindows = lit;
    this.positions.needsUpdate = true;
    this.uvs.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.index.needsUpdate = true;
    this.geometry.setDrawRange(0, indices);
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private project(window: PatchWindow, sunDir: Vec3): Corner[] {
    const { decor, room } = window;
    const centerX = decor.x + decor.nx * PANE_INSET;
    const centerZ = decor.z + decor.nz * PANE_INSET;
    const tangentX = -decor.nz;
    const tangentZ = decor.nx;
    const corner = (u: number, v: number): Corner => {
      const along = (u - 0.5) * decor.width;
      const height = decor.y + v * decor.height;
      const s = height / sunDir.y;
      return {
        x: centerX + tangentX * along - sunDir.x * s,
        z: centerZ + tangentZ * along - sunDir.z * s,
        u,
        v: 1 - v,
      };
    };
    return clipToRoom([corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)], room);
  }
}
