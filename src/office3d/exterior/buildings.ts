import { hashCity, safeHeight, type CityBlock } from './plan';
import type { ExteriorBatch } from './batch';

export const COLORS = {
  grass: 0x739b62, darkGrass: 0x638953, path: 0xc6b991,
  wall: 0xd8c9aa, cream: 0xe8ddc5, brick: 0xa95742, roof: 0x604c48,
  blue: 0x7293a4, glass: 0x9fc9cb, window: 0xf4d987, asphalt: 0x555b5d,
  white: 0xf0eee3, red: 0xb74d3b, green: 0x4d7950,
} as const;

export function placeBox(batch: ExteriorBatch, _block: CityBlock, x: number, z: number,
  width: number, depth: number, requestedHeight: number, color: number, y = 0): number {
  const height = Math.min(requestedHeight, safeHeight(x, z, width, depth) - y);
  if (height <= 0.08) return 0;
  batch.box(x, y + height / 2, z, width, height, depth, color);
  return height;
}

function detailBox(batch: ExteriorBatch, x: number, y: number, z: number,
  width: number, height: number, depth: number, color: number): void {
  if (y + height / 2 <= safeHeight(x, z, width, depth)) batch.box(x, y, z, width, height, depth, color);
}

export type Face = 'n' | 's' | 'e' | 'w';
const ALL_FACES: readonly Face[] = ['n', 's', 'e', 'w'];
const GLASS_DARK = 0x3d4a52;
/** Near-neutral so the shared window material tints them: warm lamps at night, sky-blue glass by day. */
const WINDOW_LIGHTS = [0xffffff, 0xe6dccb, 0xc9c3b8, 0xf2f6ff, 0xaeb4bd];

export interface FacadeSpec {
  /** Height of the lowest row of windows' centres. */
  readonly first: number;
  readonly floor: number;
  readonly winW: number;
  readonly winH: number;
  readonly gap: number;
  /** Share of the windows that are lit at night. */
  readonly lit: number;
  readonly salt: number;
  readonly faces?: readonly Face[];
  /** Leave the middle of this face free (a door). */
  readonly door?: Face;
}

/** Rows of windows on every wall of a box, so the building reads the same from all four camera headings. */
export function facade(solid: ExteriorBatch, lit: ExteriorBatch, block: CityBlock, x: number, z: number,
  width: number, depth: number, height: number, spec: FacadeSpec): void {
  for (const face of spec.faces ?? ALL_FACES) {
    const along = face === 'n' || face === 's' ? width : depth;
    const columns = Math.max(1, Math.floor((along - 0.6) / (spec.winW + spec.gap)));
    for (let column = 0; column < columns; column++) {
      const offset = (column + 0.5) * along / columns - along / 2;
      if (spec.door === face && Math.abs(offset) < spec.winW + 0.5) continue;
      for (let row = 0; spec.first + row * spec.floor + spec.winH / 2 <= height - 0.25; row++) {
        const y = spec.first + row * spec.floor;
        const roll = hashCity(block.col * 977 + block.row * 31 + column * 7 + row * 13, Math.round(x * 3 + z * 5) + face.charCodeAt(0), spec.salt);
        const on = roll < spec.lit;
        const color = on ? (WINDOW_LIGHTS[Math.floor(roll / spec.lit * WINDOW_LIGHTS.length)] ?? WINDOW_LIGHTS[0] ?? 0xf4d987) : GLASS_DARK;
        const pane = on ? lit : solid;
        if (face === 'n') pane.panel(x + offset, y, z - depth / 2 - 0.02, spec.winW, spec.winH, 'n', color);
        else if (face === 's') pane.panel(x + offset, y, z + depth / 2 + 0.02, spec.winW, spec.winH, 's', color);
        else if (face === 'e') pane.panel(x + width / 2 + 0.02, y, z + offset, spec.winW, spec.winH, 'e', color);
        else pane.panel(x - width / 2 - 0.02, y, z + offset, spec.winW, spec.winH, 'w', color);
      }
    }
  }
}

export function tree(batch: ExteriorBatch, _block: CityBlock, x: number, z: number, scale = 1): void {
  const trunk = Math.min(0.65 * scale, safeHeight(x, z, 0.45 * scale, 0.45 * scale) * 0.25);
  if (trunk <= 0.08) return;
  const canopy = Math.min(1.7 * scale, safeHeight(x, z, 1.8 * scale, 1.8 * scale) - trunk);
  if (canopy <= 0.08) return;
  batch.cylinder(x, trunk / 2, z, 0.16 * scale, 0.22 * scale, trunk, 0x72513c, 5);
  batch.cone(x, trunk + canopy / 2, z, 0.82 * scale, canopy, 0x477a4b, 6);
}

export function house(solid: ExteriorBatch, lit: ExteriorBatch, block: CityBlock, x: number, z: number, scale = 1): void {
  const w = 5.2 * scale;
  const d = 4.2 * scale;
  const h = placeBox(solid, block, x, z, w, d, 4.2 * scale, COLORS.cream);
  if (!h) return;
  placeBox(solid, block, x, z - d * 0.12, w * 1.08, d * 0.52, 0.65 * scale, COLORS.roof, h);
  facade(solid, lit, block, x, z, w, d, h, { first: 1.65 * scale, floor: 9, winW: 0.72 * scale, winH: 0.9 * scale, gap: 0.9 * scale, lit: 0.62, salt: 5, door: 's' });
  detailBox(solid, x, 1.05 * scale, z + d / 2 + 0.02, 0.85 * scale, 2.1 * scale, 0.1, 0x73523d);
}

export function apartment(solid: ExteriorBatch, lit: ExteriorBatch, block: CityBlock, x: number, z: number, scale = 1): void {
  const w = 7 * scale, d = 6 * scale;
  const h = placeBox(solid, block, x, z, w, d, 10 * scale, COLORS.brick);
  if (h) facade(solid, lit, block, x, z, w, d, h, { first: 1.5, floor: 2.3, winW: 1.05 * scale, winH: 0.82 * scale, gap: 1.1 * scale, lit: 0.54, salt: 19 });
  placeBox(solid, block, x, z, w * 1.04, d * 1.04, 0.35, COLORS.roof, h);
}

export function officeTower(solid: ExteriorBatch, lit: ExteriorBatch, block: CityBlock, x: number, z: number, scale = 1): void {
  const w = 8 * scale, d = 7 * scale;
  const h = placeBox(solid, block, x, z, w, d, 19 * scale, COLORS.blue);
  if (h) facade(solid, lit, block, x, z, w, d, h, { first: 1.6, floor: 2.6, winW: 1.45 * scale, winH: 1.4 * scale, gap: 0.8 * scale, lit: 0.68, salt: 31 });
  placeBox(solid, block, x, z, w * 1.04, d * 1.04, 0.35, COLORS.white, h);
}
