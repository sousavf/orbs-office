import { BoxGeometry, type BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OFFICE, WALLS, wallRect } from './layout';
import type { WallSegment, ZoneOrOutside } from './layout.types';
import type { Materials } from './materials';
import { WALL_CAP, shade, wallColor } from './palette';
import { PartBuilder, StaticBatch } from './props/kit';

const { wallHeight: HEIGHT, wallThickness: THICK } = OFFICE;
const SKIRT_HEIGHT = 0.12;
/** Heights walls drop to when they would hide the room behind them. */
const STUB_EXTERIOR = 0.4;
const STUB_INTERIOR = 1.2;
/** Walls hiding the dormitory drop lower, so bunks pressed against them stay in view. */
const STUB_DORM = 0.5;
const EASE_RATE = 9;
/** A non-indexed box has 36 vertices. */
const SKIRT_VERTICES = 36;

interface WallEntry {
  readonly segment: WallSegment;
  readonly group: Group;
  /** Wall scale.y: 1 is full height. */
  current: number;
  target: number;
}

/** Perpendicular unit normal pointing at the positive side of the wall. */
function positiveNormal(segment: WallSegment): { x: number; z: number } {
  return segment.axis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 };
}

/** Painted walls with skirting, glass partitions and the camera-facing cutaway. */
export class WorldWalls {
  readonly group = new Group();
  private readonly entries: WallEntry[] = [];
  /** One vertex-coloured material for every wall body, so each wall is a single draw call. */
  private readonly bodyMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  private readonly skirtMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  private readonly bodies: { geometry: BoxGeometry; segment: WallSegment }[] = [];
  private readonly skirts: { geometry: BufferGeometry; zone: ZoneOrOutside }[] = [];
  private skirtGeometry: BufferGeometry | null = null;
  private readonly geometries: BufferGeometry[] = [];

  constructor(private readonly materials: Materials) {
    for (const segment of WALLS) this.addSegment(segment);
    this.buildSkirts();
    this.paint();
  }

  private paint(): void {
    const cap = new Color(WALL_CAP);
    for (const { geometry, segment } of this.bodies) {
      const neg = new Color(wallColor(segment.sideNeg));
      const pos = new Color(wallColor(segment.sidePos));
      const faces =
        segment.axis === 'x' ? [pos, pos, cap, cap, pos, neg] : [pos, neg, cap, cap, pos, pos];
      paintFaces(geometry, faces);
    }
    this.paintSkirts();
  }

  /** Points the cutaway at a camera whose horizontal direction (toward the camera) is (cx, cz). */
  setCamera(cx: number, cz: number): void {
    for (const entry of this.entries) entry.target = this.targetFor(entry.segment, cx, cz);
  }

  snap(): void {
    for (const entry of this.entries) this.apply(entry, entry.target);
  }

  /** Eases walls toward their targets; returns true while any is still moving. */
  update(deltaSeconds: number): boolean {
    const k = 1 - Math.exp(-EASE_RATE * deltaSeconds);
    let moving = false;
    for (const entry of this.entries) {
      const diff = entry.target - entry.current;
      if (Math.abs(diff) < 0.002) {
        if (entry.current !== entry.target) this.apply(entry, entry.target);
        continue;
      }
      this.apply(entry, entry.current + diff * k);
      moving = true;
    }
    return moving;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.skirtGeometry?.dispose();
    this.bodyMaterial.dispose();
    this.skirtMaterial.dispose();
  }

  private apply(entry: WallEntry, scale: number): void {
    entry.current = scale;
    entry.group.scale.y = Math.max(scale, 0.01);
  }

  private targetFor(segment: WallSegment, cx: number, cz: number): number {
    if (segment.kind === 'glass') return 1;
    const n = positiveNormal(segment);
    const facesCamera = n.x * cx + n.z * cz > 0;
    // The far side (away from the camera) is the room this wall would hide.
    const farZone = facesCamera ? segment.sideNeg : segment.sidePos;
    const nearZone = facesCamera ? segment.sidePos : segment.sideNeg;
    if (farZone === 'outside') return 1;
    if (nearZone === 'outside') return STUB_EXTERIOR / HEIGHT;
    return (farZone === 'dormitory' ? STUB_DORM : STUB_INTERIOR) / HEIGHT;
  }

  private addSegment(segment: WallSegment): void {
    const rect = wallRect(segment);
    const start = segment.axis === 'x' ? rect.x0 : rect.z0;
    const end = segment.axis === 'x' ? rect.x1 : rect.z1;
    const length = end - start;
    const mid = (start + end) / 2;
    const holder = new Group();
    holder.position.set(segment.axis === 'x' ? mid : segment.fixed, 0, segment.axis === 'x' ? segment.fixed : mid);
    const body = new Group();
    holder.add(body);
    const dims: [number, number, number] =
      segment.axis === 'x' ? [length, HEIGHT, THICK] : [THICK, HEIGHT, length];
    if (segment.kind === 'glass') this.addGlass(body, segment, length);
    else this.addSolid(body, segment, dims);
    this.addSkirts(segment, dims, holder.position.x, holder.position.z);
    this.group.add(holder);
    this.entries.push({ segment, group: body, current: 1, target: 1 });
  }

  private addSolid(body: Group, segment: WallSegment, dims: [number, number, number]): void {
    const geometry = new BoxGeometry(dims[0], dims[1], dims[2]);
    this.bodies.push({ geometry, segment });
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, this.bodyMaterial);
    mesh.position.y = HEIGHT / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
  }

  private addGlass(body: Group, segment: WallSegment, length: number): void {
    const thin: [number, number, number] =
      segment.axis === 'x' ? [length, HEIGHT - 0.1, 0.03] : [0.03, HEIGHT - 0.1, length];
    const geometry = new BoxGeometry(thin[0], thin[1], thin[2]);
    this.geometries.push(geometry);
    const pane = new Mesh(geometry, this.materials.get('glass'));
    pane.position.y = HEIGHT / 2 + 0.05;
    pane.renderOrder = 2;
    body.add(pane);

    const frame = new PartBuilder();
    const along = (offset: number, size: number, y: number, h: number): void => {
      const w = segment.axis === 'x' ? size : 0.06;
      const d = segment.axis === 'x' ? 0.06 : size;
      const x = segment.axis === 'x' ? offset : 0;
      const z = segment.axis === 'x' ? 0 : offset;
      frame.box('darkGrey', [w, h, d], [x, y, z]);
    };
    along(0, length, 0, 0.1);
    along(0, length, HEIGHT - 0.06, 0.06);
    along(-length / 2 + 0.03, 0.06, 0, HEIGHT);
    along(length / 2 - 0.03, 0.06, 0, HEIGHT);
    const posts = Math.max(1, Math.round(length / 1.5));
    for (let i = 1; i < posts; i++) along(-length / 2 + (length / posts) * i, 0.05, 0, HEIGHT);
    along(0, length, 1.0, 0.04);
    const batch = new StaticBatch();
    batch.add(frame.done(), new Matrix4());
    body.add(batch.build(this.materials));
  }

  /** Skirting boards stay put when the wall above them drops; all are merged into one mesh in world space. */
  private addSkirts(segment: WallSegment, dims: [number, number, number], cx: number, cz: number): void {
    if (segment.kind === 'glass') return;
    const grow = 0.02;
    const place = (zone: ZoneOrOutside, side: -1 | 1): void => {
      const sx = segment.axis === 'x' ? dims[0] + 0.02 : grow;
      const sz = segment.axis === 'x' ? grow : dims[2] + 0.02;
      const offset = side * (THICK / 2 + grow / 2);
      const geometry = new BoxGeometry(sx, SKIRT_HEIGHT, sz).toNonIndexed();
      geometry.translate(segment.axis === 'x' ? cx : cx + offset, SKIRT_HEIGHT / 2, segment.axis === 'x' ? cz + offset : cz);
      this.skirts.push({ geometry, zone });
    };
    place(segment.sideNeg, -1);
    place(segment.sidePos, 1);
  }

  private buildSkirts(): void {
    const merged = mergeGeometries(this.skirts.map((skirt) => skirt.geometry), false);
    if (merged === null) return;
    for (const skirt of this.skirts) skirt.geometry.dispose();
    const mesh = new Mesh(merged, this.skirtMaterial);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.skirtGeometry = merged;
  }

  private paintSkirts(): void {
    const geometry = this.skirtGeometry;
    if (geometry === null) return;
    const data = new Float32Array(geometry.getAttribute('position').count * 3);
    const perPiece = SKIRT_VERTICES * 3;
    this.skirts.forEach(({ zone }, index) => {
      const color = new Color(shade(wallColor(zone), 0.74));
      for (let v = 0; v < SKIRT_VERTICES; v++) {
        data.set([color.r, color.g, color.b], index * perPiece + v * 3);
      }
    });
    geometry.setAttribute('color', new Float32BufferAttribute(data, 3));
  }
}

/** Writes one colour per box face (BoxGeometry order: +x, -x, +y, -y, +z, -z) as vertex colours. */
function paintFaces(geometry: BufferGeometry, faces: readonly Color[]): void {
  const count = geometry.getAttribute('position').count;
  const verticesPerFace = count / 6;
  const data = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const color = faces[Math.floor(v / verticesPerFace)] ?? faces[0];
    if (color === undefined) continue;
    data[v * 3] = color.r;
    data[v * 3 + 1] = color.g;
    data[v * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(data, 3));
}
