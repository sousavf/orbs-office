import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  SphereGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type MatKey, type Materials, NO_CAST } from '../materials';

export type V3 = readonly [number, number, number];

/** One coloured piece of a prop, already positioned in the prop's local space. */
export interface Part {
  readonly geometry: BufferGeometry;
  readonly mat: MatKey;
}

export interface Rotation {
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

/** RoundedBoxGeometry is non-indexed while the other primitives are indexed; merging needs one form. */
function place(source: BufferGeometry, pos: V3, rot: Rotation): BufferGeometry {
  const geometry = source.index === null ? source : source.toNonIndexed();
  if (rot.rx !== undefined) geometry.rotateX(rot.rx);
  if (rot.rz !== undefined) geometry.rotateZ(rot.rz);
  if (rot.ry !== undefined) geometry.rotateY(rot.ry);
  geometry.translate(pos[0], pos[1], pos[2]);
  return geometry;
}

/** Collects primitives for a prop. Positions give the bottom centre of each primitive. */
export class PartBuilder {
  private readonly parts: Part[] = [];

  box(mat: MatKey, size: V3, pos: V3, rot: Rotation = {}): this {
    const g = new BoxGeometry(size[0], size[1], size[2]).translate(0, size[1] / 2, 0);
    this.parts.push({ geometry: place(g, pos, rot), mat });
    return this;
  }

  round(mat: MatKey, size: V3, radius: number, pos: V3, rot: Rotation = {}): this {
    const r = Math.min(radius, size[0] / 2.01, size[1] / 2.01, size[2] / 2.01);
    const g = new RoundedBoxGeometry(size[0], size[1], size[2], 1, r).translate(0, size[1] / 2, 0);
    this.parts.push({ geometry: place(g, pos, rot), mat });
    return this;
  }

  cyl(mat: MatKey, radiusTop: number, radiusBottom: number, height: number, pos: V3, segments = 16, rot: Rotation = {}): this {
    const g = new CylinderGeometry(radiusTop, radiusBottom, height, segments).translate(0, height / 2, 0);
    this.parts.push({ geometry: place(g, pos, rot), mat });
    return this;
  }

  sphere(mat: MatKey, radius: number, pos: V3, scale: V3 = [1, 1, 1], segments = 12): this {
    const g = new SphereGeometry(radius, segments, Math.max(6, segments - 4));
    g.scale(scale[0], scale[1], scale[2]);
    this.parts.push({ geometry: place(g, pos, {}), mat });
    return this;
  }

  cone(mat: MatKey, radius: number, height: number, pos: V3, rot: Rotation = {}, segments = 8): this {
    const g = new ConeGeometry(radius, height, segments).translate(0, height / 2, 0);
    this.parts.push({ geometry: place(g, pos, rot), mat });
    return this;
  }

  add(parts: readonly Part[], offset: V3 = [0, 0, 0], ry = 0): this {
    for (const part of parts) {
      this.parts.push({ geometry: place(part.geometry.clone(), offset, { ry }), mat: part.mat });
    }
    return this;
  }

  done(): Part[] {
    return this.parts;
  }
}

export function matrixAt(x: number, y: number, z: number, rotY = 0): Matrix4 {
  return new Matrix4().makeRotationY(rotY).setPosition(x, y, z);
}

function meshFor(geometry: BufferGeometry, mat: MatKey, materials: Materials): Mesh {
  const mesh = new Mesh(geometry, materials.get(mat));
  mesh.castShadow = !NO_CAST.has(mat);
  mesh.receiveShadow = mat !== 'screen' && mat !== 'lamp' && mat !== 'glass';
  return mesh;
}

function mergeByMaterial(parts: readonly Part[], transform: Matrix4 | null): Map<MatKey, BufferGeometry> {
  const grouped = new Map<MatKey, BufferGeometry[]>();
  for (const part of parts) {
    const geometry = transform === null ? part.geometry : part.geometry.clone().applyMatrix4(transform);
    const list = grouped.get(part.mat) ?? [];
    list.push(geometry);
    grouped.set(part.mat, list);
  }
  const merged = new Map<MatKey, BufferGeometry>();
  for (const [mat, list] of grouped) {
    const geometry = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (geometry) merged.set(mat, geometry);
  }
  return merged;
}

/** Bakes many one-off pieces into one mesh per material, so draw calls do not grow with prop count. */
export class StaticBatch {
  private readonly baked: Part[] = [];

  add(parts: readonly Part[], matrix: Matrix4): void {
    for (const part of parts) {
      this.baked.push({ geometry: part.geometry.clone().applyMatrix4(matrix), mat: part.mat });
    }
  }

  build(materials: Materials): Group {
    const group = new Group();
    for (const [mat, geometry] of mergeByMaterial(this.baked, null)) group.add(meshFor(geometry, mat, materials));
    for (const part of this.baked) part.geometry.dispose();
    return group;
  }
}

export interface InstancedProp {
  readonly group: Group;
  readonly meshes: ReadonlyMap<MatKey, InstancedMesh>;
}

/**
 * One InstancedMesh per material for `matrices.length` copies of a prop.
 * `colors` tints a material per instance (the material colour multiplies it).
 */
export function instanceProp(
  parts: readonly Part[],
  matrices: readonly Matrix4[],
  materials: Materials,
  colors: Partial<Record<MatKey, readonly number[]>> = {},
): InstancedProp {
  const group = new Group();
  const meshes = new Map<MatKey, InstancedMesh>();
  if (matrices.length === 0) return { group, meshes };
  for (const [mat, geometry] of mergeByMaterial(parts, null)) {
    const mesh = new InstancedMesh(geometry, materials.get(mat), matrices.length);
    mesh.castShadow = !NO_CAST.has(mat);
    mesh.receiveShadow = mat !== 'screen' && mat !== 'lamp';
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    const tint = colors[mat];
    if (tint !== undefined && tint.length > 0) {
      const color = new Color();
      matrices.forEach((_, index) => mesh.setColorAt(index, color.setHex(tint[index % tint.length] ?? 0xffffff)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    meshes.set(mat, mesh);
  }
  return { group, meshes };
}

/** Deterministic pseudo-random sequence so layouts look the same on every load. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
