import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Material, Mesh, PlaneGeometry, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface ExteriorPrimitive {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
  readonly color: number;
}

/** Bakes the neighbourhood's many coloured primitives into one lit draw call. */
export class ExteriorBatch {
  private readonly parts: BufferGeometry[] = [];
  readonly primitives: ExteriorPrimitive[] = [];
  triangleCount = 0;

  box(x: number, y: number, z: number, width: number, height: number, depth: number, color: number, rz = 0, ry = 0): void {
    const geometry = new BoxGeometry(width, height, depth);
    if (rz !== 0) geometry.rotateZ(rz);
    if (ry !== 0) geometry.rotateY(ry);
    geometry.translate(x, y, z);
    this.add(geometry, color);
  }

  /** A one-sided flat pane (two triangles) facing north (-z), south, east or west; the cheap way to draw a window. */
  panel(x: number, y: number, z: number, width: number, height: number, face: 'n' | 's' | 'e' | 'w', color: number): void {
    const geometry = new PlaneGeometry(width, height);
    if (face === 'n') geometry.rotateY(Math.PI);
    else if (face === 'e') geometry.rotateY(Math.PI / 2);
    else if (face === 'w') geometry.rotateY(-Math.PI / 2);
    geometry.translate(x, y, z);
    this.add(geometry, color);
  }

  cylinder(x: number, y: number, z: number, top: number, bottom: number, height: number, color: number, sides = 7): void {
    const geometry = new CylinderGeometry(top, bottom, height, sides);
    geometry.translate(x, y, z);
    this.add(geometry, color);
  }

  cone(x: number, y: number, z: number, radius: number, height: number, color: number, sides = 7): void {
    const geometry = new ConeGeometry(radius, height, sides);
    geometry.translate(x, y, z);
    this.add(geometry, color);
  }

  sphere(x: number, y: number, z: number, radius: number, color: number): void {
    const geometry = new SphereGeometry(radius, 8, 6);
    geometry.translate(x, y, z);
    this.add(geometry, color);
  }

  build(material: Material): Mesh {
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    if (merged === null) throw new Error('Could not merge exterior geometry');
    const mesh = new Mesh(merged, material);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    return mesh;
  }

  private add(source: BufferGeometry, hex: number): void {
    const geometry = source.toNonIndexed();
    source.dispose();
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (bounds === null) throw new Error('Exterior primitive has no bounds');
    this.primitives.push({ x0: bounds.min.x, x1: bounds.max.x, y0: bounds.min.y, y1: bounds.max.y, z0: bounds.min.z, z1: bounds.max.z, color: hex });
    const color = new Color(hex);
    const position = geometry.getAttribute('position');
    if (position === undefined) throw new Error('Exterior primitive has no positions');
    this.triangleCount += position.count / 3;
    const values = new Float32Array(position.count * 3);
    for (let index = 0; index < values.length; index += 3) {
      values[index] = color.r;
      values[index + 1] = color.g;
      values[index + 2] = color.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(values, 3));
    this.parts.push(geometry);
  }
}
