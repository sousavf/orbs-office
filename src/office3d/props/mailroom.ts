import { type MatKey } from '../materials';
import { type Part, PartBuilder, seeded } from './kit';

const PARCELS: readonly MatKey[] = ['parcelKraft', 'parcelRed', 'parcelBlue', 'parcelYellow', 'parcelKraft'];

/** Pigeonhole unit 1.5 x 0.5 x 1.9 m, openings toward +z, filled with parcels and letters. */
export function shelfParts(seed: number): Part[] {
  const b = new PartBuilder();
  const rand = seeded(seed * 97 + 13);
  const width = 1.5;
  const depth = 0.5;
  const height = 1.9;
  const board = 0.03;
  const cols = 4;
  const rows = 5;
  b.box('woodDark', [width, height, 0.02], [0, 0, -depth / 2 + 0.01]);
  for (const side of [-1, 1]) b.box('woodLight', [board, height, depth], [side * (width / 2 - board / 2), 0, 0]);
  b.box('woodLight', [width, board, depth], [0, height - board, 0]);
  b.box('woodLight', [width, 0.08, depth], [0, 0, 0]);
  const innerW = width - board * 2;
  const cellW = innerW / cols;
  const cellH = (height - 0.08 - board) / rows;
  for (let c = 1; c < cols; c++) {
    b.box('woodLight', [board * 0.6, height - 0.08 - board, depth - 0.02], [-innerW / 2 + c * cellW, 0.08, 0.0]);
  }
  for (let r = 1; r < rows; r++) b.box('woodLight', [innerW, board * 0.6, depth - 0.02], [0, 0.08 + r * cellH, 0]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const roll = rand();
      if (roll < 0.3) continue;
      const x = -innerW / 2 + cellW * (c + 0.5);
      const y = 0.08 + r * cellH + board * 0.3;
      if (roll < 0.62) {
        const mat = PARCELS[Math.floor(rand() * PARCELS.length)] ?? 'parcelKraft';
        b.box(mat, [cellW * 0.7, cellH * (0.45 + rand() * 0.25), depth * 0.6], [x, y, 0.02], { ry: (rand() - 0.5) * 0.15 });
      } else {
        b.box('paper', [cellW * 0.5, cellH * 0.55, 0.012], [x, y, 0.1], { rz: (rand() - 0.5) * 0.4 });
        b.box('paper', [cellW * 0.45, cellH * 0.45, 0.012], [x + 0.02, y, 0.08], { rz: (rand() - 0.5) * 0.4 });
      }
    }
  }
  return b.done();
}

/** Sorting table with trays, a scale, a roll of tape and a desk lamp. */
export function sortingTableParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.round('woodLight', [width, 0.05, depth], 0.015, [0, 0.8, 0]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.box('darkGrey', [0.06, 0.8, 0.06], [x * (width / 2 - 0.1), 0, z * (depth / 2 - 0.1)]);
  }
  b.box('darkGrey', [width - 0.2, 0.04, 0.04], [0, 0.25, depth / 2 - 0.1]);
  b.box('woodDark', [width - 0.3, 0.03, depth - 0.3], [0, 0.22, 0]);
  b.box('parcelKraft', [0.5, 0.22, 0.4], [-0.6, 0.25, 0]);
  b.box('parcelBlue', [0.4, 0.18, 0.35], [0.1, 0.25, 0.02]);
  for (let i = 0; i < 4; i++) {
    b.box('steel', [0.38, 0.06, 0.3], [-0.95 + i * 0.45, 0.85, -0.2]);
    b.box(PARCELS[i] ?? 'parcelKraft', [0.26, 0.06 + i * 0.015, 0.18], [-0.95 + i * 0.45, 0.88, -0.2], { ry: 0.1 * i });
  }
  b.box('parcelKraft', [0.36, 0.2, 0.28], [0.45, 0.85, 0.15], { ry: 0.3 });
  b.box('parcelRed', [0.24, 0.12, 0.2], [0.45, 1.05, 0.15], { ry: -0.2 });
  b.box('darkGrey', [0.28, 0.03, 0.22], [0.95, 0.85, 0.1]);
  b.cyl('white', 0.08, 0.08, 0.06, [0.95, 0.88, 0.1], 12);
  b.cyl('hazard', 0.05, 0.05, 0.04, [0.8, 0.85, -0.25], 10);
  b.cyl('darkGrey', 0.07, 0.08, 0.02, [1.05, 0.85, -0.25], 10);
  b.cyl('darkGrey', 0.01, 0.01, 0.26, [1.05, 0.87, -0.25], 6);
  b.cyl('lamp', 0.07, 0.09, 0.1, [1.05, 1.1, -0.2], 10, { rx: 0.5 });
  return b.done();
}

/** A pile of parcels and a crate. */
export function parcelPileParts(): Part[] {
  const b = new PartBuilder();
  b.box('woodLight', [0.7, 0.3, 0.5], [0, 0, 0]);
  b.box('woodDark', [0.62, 0.04, 0.42], [0, 0.3, 0]);
  b.box('parcelKraft', [0.4, 0.28, 0.32], [-0.1, 0.34, 0], { ry: 0.2 });
  b.box('parcelRed', [0.3, 0.2, 0.26], [0.0, 0.62, 0], { ry: -0.2 });
  b.box('parcelBlue', [0.28, 0.2, 0.24], [0.2, 0.34, 0.1], { ry: 0.4 });
  b.box('parcelYellow', [0.2, 0.14, 0.2], [-0.18, 0.62, 0.02], { ry: 0.6 });
  return b.done();
}
