import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLANDS } from '../layout';
import type { IslandId } from '../layout.types';
import type { Materials } from '../materials';

const SIGN = { width: 1.5, height: 0.36, thickness: 0.04 } as const;
const CELL = { width: 480, height: 116 } as const;
const MAX_NAME = 18;
const FONT = '700 54px system-ui, -apple-system, "Segoe UI", sans-serif';
const CABLE_REACH = 0.3;

function drawName(ctx: CanvasRenderingContext2D, row: number, text: string): void {
  const y = row * CELL.height;
  ctx.clearRect(0, y, CELL.width, CELL.height);
  ctx.fillStyle = '#f6efdc';
  ctx.beginPath();
  ctx.roundRect(0, y, CELL.width, CELL.height, 18);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#4c7a56';
  ctx.beginPath();
  ctx.roundRect(8, y + 8, CELL.width - 16, CELL.height - 16, 12);
  ctx.stroke();
  ctx.fillStyle = '#35553d';
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, CELL.width / 2, y + CELL.height / 2 + 3, CELL.width - 56);
}

/** One plane showing atlas row `row` of `rows`, turned about y and moved into place. */
function facePlane(row: number, rows: number, x: number, y: number, z: number, turned: boolean): BufferGeometry {
  const plane = new PlaneGeometry(SIGN.width, SIGN.height);
  const uv = plane.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1) / rows + uv.getY(i) / rows);
  if (turned) plane.rotateY(Math.PI);
  const side = turned ? -1 : 1;
  return plane.translate(x, y, z + side * (SIGN.thickness / 2 + 0.002));
}

/**
 * A hanging sign over each workspace island, with a name you can change at any time. All six share one
 * canvas atlas, so the faces are a single draw and the frames and cables another.
 */
export class IslandSigns {
  readonly group = new Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly material: MeshStandardMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly names = new Map<IslandId, string>();
  private readonly rows = new Map<IslandId, number>();

  constructor(shared: Materials) {
    const count = ISLANDS.length;
    this.canvas.width = CELL.width;
    this.canvas.height = CELL.height * count;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new MeshStandardMaterial({ map: this.texture, roughness: 0.8 });
    const ctx = this.canvas.getContext('2d');

    const faces: BufferGeometry[] = [];
    const frames: BufferGeometry[] = [];
    ISLANDS.forEach((island, row) => {
      this.names.set(island.id, island.defaultName);
      this.rows.set(island.id, row);
      if (ctx !== null) drawName(ctx, row, island.defaultName);
      const { x, y, z } = island.sign;
      faces.push(facePlane(row, count, x, y, z, false), facePlane(row, count, x, y, z, true));
      frames.push(new BoxGeometry(SIGN.width + 0.02, SIGN.height + 0.02, SIGN.thickness).translate(x, y, z));
      for (const dx of [-0.6, 0.6]) {
        frames.push(new CylinderGeometry(0.006, 0.006, CABLE_REACH, 4).translate(x + dx, y + SIGN.height / 2 + CABLE_REACH / 2, z));
      }
    });
    const faceGeometry = mergeGeometries(faces, false);
    const frameGeometry = mergeGeometries(frames, false);
    for (const geometry of [...faces, ...frames]) geometry.dispose();
    this.geometries.push(faceGeometry, frameGeometry);
    this.group.add(new Mesh(faceGeometry, this.material), new Mesh(frameGeometry, shared.get('darkGrey')));
  }

  /** Renames an island's sign; empty names fall back to the default. Unknown ids are ignored. */
  setIslandName(islandId: IslandId, name: string): void {
    const row = this.rows.get(islandId);
    const island = ISLANDS.find((candidate) => candidate.id === islandId);
    if (row === undefined || island === undefined) return;
    const trimmed = name.trim().slice(0, MAX_NAME) || island.defaultName;
    if (trimmed === this.names.get(islandId)) return;
    this.names.set(islandId, trimmed);
    const ctx = this.canvas.getContext('2d');
    if (ctx !== null) drawName(ctx, row, trimmed);
    this.texture.needsUpdate = true;
  }

  islandName(islandId: IslandId): string {
    return this.names.get(islandId) ?? '';
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
