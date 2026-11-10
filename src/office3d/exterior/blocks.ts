import type { ExteriorBatch } from './batch';
import { COLORS, apartment, facade, house, officeTower, placeBox, tree } from './buildings';
import { hashCity, safeHeight, type CityBlock, type CityPlan } from './plan';

type Shadow = [number, number, number, number];

function rand(block: CityBlock, salt: number): number {
  return hashCity(block.col, block.row, salt);
}

function detail(batch: ExteriorBatch, x: number, y: number, z: number,
  width: number, height: number, depth: number, color: number): void {
  if (y + height / 2 <= safeHeight(x, z, width, depth)) batch.box(x, y, z, width, height, depth, color);
}

function ground(solid: ExteriorBatch, block: CityBlock, color: number): void {
  const width = Math.max(1, block.width - 12);
  const depth = Math.max(1, block.depth - 12);
  detail(solid, block.x, -0.07, block.z, width, 0.14, depth, color);
  const palette = block.kind === 'houses' || block.kind === 'park' || block.kind === 'school' || block.kind === 'football'
    ? [0x6d945e, 0x769c65, 0x789f68, 0x719761]
    : [0xa99e8b, 0xb0a58f, 0xa79e8e, 0xb4aa97];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const x = block.x + (col - 1) * width / 3;
    const z = block.z + (row - 1) * depth / 3;
    const shade = Math.floor(hashCity(block.col * 3 + col, block.row * 3 + row, 781) * palette.length);
    detail(solid, x, 0.006, z, width / 3, 0.012, depth / 3, palette[shade] ?? color);
  }
}

function fence(solid: ExteriorBatch, _block: CityBlock, x: number, z: number, w: number, d: number): void {
  const color = 0xe5dfc9;
  for (let offset = -w / 2; offset <= w / 2 + 0.01; offset += 1.8) {
    detail(solid, x + offset, 0.42, z - d / 2, 0.12, 0.84, 0.12, color);
    detail(solid, x + offset, 0.42, z + d / 2, 0.12, 0.84, 0.12, color);
  }
  detail(solid, x, 0.65, z - d / 2, w, 0.12, 0.12, color);
  detail(solid, x, 0.35, z - d / 2, w, 0.12, 0.12, color);
  detail(solid, x - w / 2, 0.65, z, 0.12, 0.12, d, color);
  detail(solid, x - w / 2, 0.35, z, 0.12, 0.12, d, color);
}

function walls(solid: ExteriorBatch, lit: ExteriorBatch, block: CityBlock, x: number, z: number, width: number, depth: number,
  height: number, salt: number, faces?: readonly ('n' | 's' | 'e' | 'w')[]): void {
  if (height < 2.4) return;
  facade(solid, lit, block, x, z, width, depth, height, { first: 1.5, floor: 2.4, winW: 1.15, winH: 1.1, gap: 1.2, lit: 0.55, salt, ...(faces === undefined ? {} : { faces }) });
}

function houseBlock(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch, shadows: Shadow[]): void {
  ground(solid, block, COLORS.grass);
  const rows = block.depth > 45 ? 2 : 1;
  const cols = block.width > 45 ? 3 : 2;
  const dx = block.width / (cols + 1), dz = block.depth / (rows + 1);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = block.x - block.width / 2 + dx * (col + 1);
    const z = block.z - block.depth / 2 + dz * (row + 1);
    const w = Math.min(5.4, dx * 0.62), d = Math.min(4.5, dz * 0.58);
    house(solid, lit, block, x, z, Math.min(w / 5.2, d / 4.2));
    const garageX = x + (col % 2 ? 3.8 : -3.8);
    detail(solid, garageX, 0.05, z + 4, 1.1, 0.1, 6, 0xaaa69c);
    if (placeBox(solid, block, garageX, z + 7.4, 2.8, 2.8, 2.25, 0xd4c5a9)) {
      detail(solid, garageX, 1.05, z + 5.97, 2.1, 1.6, 0.07, 0x77756d);
    }
    const gardenX = x + (col % 2 ? -4.8 : 4.8);
    fence(solid, block, gardenX, z, 3.6, 4.2);
    placeBox(solid, block, gardenX, z, 0.55, 0.55, 0.8, 0x4b804c);
    if (safeHeight(x, z, 6, 5) > 3) shadows.push([x, z, 5, 4]);
  }
}

function apartments(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch, shadows: Shadow[]): void {
  ground(solid, block, 0x82927a);
  const count = Math.max(2, Math.min(5, Math.floor(block.width / 16)));
  for (let i = 0; i < count; i++) {
    const x = block.x - block.width / 2 + block.width * (i + 1) / (count + 1);
    apartment(solid, lit, block, x, block.z, 0.85);
    if (safeHeight(x, block.z, 7, 6) > 8) shadows.push([x, block.z, 7, 6]);
  }
  for (let i = 0; i < count + 1; i++) tree(solid, block,
    block.x - block.width * 0.38 + i * block.width * 0.76 / count, block.z + block.depth * 0.35, 0.65);
}

function downtown(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch, shadows: Shadow[]): void {
  ground(solid, block, 0x777c7b);
  const count = Math.max(2, Math.min(5, Math.floor(block.width / 17)));
  for (let i = 0; i < count; i++) {
    const x = block.x - block.width / 2 + block.width * (i + 1) / (count + 1);
    officeTower(solid, lit, block, x, block.z - block.depth * 0.12, 0.75 + rand(block, i + 41) * 0.3);
    if (safeHeight(x, block.z - block.depth * 0.12, 8, 7) > 12) shadows.push([x, block.z - block.depth * 0.12, 8, 7]);
  }
}

function shops(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch): void {
  ground(solid, block, 0xb6a789);
  if (block.col === 0 && block.row === 1) {
    for (const x of [4, 24, 44]) {
      const depth = 6.2;
      const z = 47.9 + depth / 2;
      const width = 12;
      const h = placeBox(solid, block, x, z, width, depth, 5.2, COLORS.cream);
      if (!h) continue;
      walls(solid, lit, block, x, z, width, depth, h, 61 + x, ['s', 'e', 'w']);
      if (rand(block, x * 13) > 0.28) detail(lit, x, 1.45, 47.87, 7, 1.8, 0.06, COLORS.glass);
      detail(solid, x, 3.2, 47.35, 8.4, 0.18, 1, x === 24 ? 0x4c7d9b : COLORS.red);
    }
    return;
  }
  const count = Math.max(3, Math.min(7, Math.floor(block.width / 11)));
  const each = block.width * 0.76 / count;
  for (let i = 0; i < count; i++) {
    const x = block.x - block.width * 0.38 + each * (i + 0.5);
    const h = placeBox(solid, block, x, block.z, each * 0.86, Math.min(8, block.depth * 0.55), 5.2, [0xd8cbb5, 0xc5d2ce, 0xd6b5a1][i % 3] ?? COLORS.cream);
    if (!h) continue;
    walls(solid, lit, block, x, block.z, each * 0.86, Math.min(8, block.depth * 0.55), h, 71 + i, ['s', 'e', 'w']);
    detail(lit, x, 1.45, block.z - Math.min(4, block.depth * 0.28) - 0.03, each * 0.55, 1.8, 0.06, COLORS.glass);
    detail(solid, x, 3.2, block.z - Math.min(4, block.depth * 0.28) - 0.5, each * 0.7, 0.18, 1, i % 2 ? COLORS.red : 0x4c7d9b);
  }
}

function park(block: CityBlock, solid: ExteriorBatch): void {
  ground(solid, block, COLORS.darkGrass);
  detail(solid, block.x, 0.025, block.z, 2.2, 0.03, Math.max(1, block.depth - 12), COLORS.path);
  detail(solid, block.x, 0.03, block.z, Math.max(1, (block.width - 12) * 0.72), 0.03, 1.8, COLORS.path);
  const n = Math.max(5, Math.min(16, Math.floor(block.width * block.depth / 300)));
  for (let i = 0; i < n; i++) {
    const x = block.x + (rand(block, i + 100) - 0.5) * block.width * 0.75;
    const z = block.z + (rand(block, i + 200) - 0.5) * block.depth * 0.72;
    tree(solid, block, x, z, 0.55 + rand(block, i + 300) * 0.3);
  }
  const pondW = Math.min(10, block.width * 0.16), pondD = Math.min(7, block.depth * 0.15);
  detail(solid, block.x + block.width * 0.28, 0.025, block.z - block.depth * 0.27, pondW, 0.05, pondD, 0x6ca9b0);
}

function school(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch, shadows: Shadow[]): void {
  ground(solid, block, 0x6e925e);
  const x = block.x, z = block.z - block.depth * 0.18;
  const h = placeBox(solid, block, x, z, Math.min(19, block.width * 0.48), Math.min(12, block.depth * 0.28), 7, 0xd8c8a8);
  detail(lit, x, 1.7, z - 6.02, 7, 1.4, 0.08, COLORS.window);
  if (h) walls(solid, lit, block, x, z, Math.min(19, block.width * 0.48), Math.min(12, block.depth * 0.28), h, 83, ['s', 'e', 'w']);
  detail(solid, x, 3.8, z - 6.3, 5, 0.16, 0.7, COLORS.red);
  if (h) shadows.push([x, z, Math.min(19, block.width * 0.48), Math.min(12, block.depth * 0.28)]);
  const playZ = z + block.depth * 0.32;
  detail(solid, x, 0.025, playZ, block.width * 0.5, 0.05, block.depth * 0.25, 0xb8a078);
  detail(solid, x, 0.45, playZ, 0.16, 0.8, 4, 0xd74d42);
  detail(solid, x - 2, 0.85, playZ, 4, 0.12, 0.12, 0xd74d42);
  detail(solid, x - 2, 0.25, playZ - 1.8, 0.12, 0.5, 0.12, 0xd74d42);
  detail(solid, x + 2, 0.25, playZ - 1.8, 0.12, 0.5, 0.12, 0xd74d42);
}

function townHall(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch): void {
  ground(solid, block, 0xb8aa8c);
  detail(solid, block.x, 0.025, block.z, block.width * 0.72, 0.05, 2.2, COLORS.path);
  const x = block.x, z = block.z - block.depth * 0.2;
  const h = placeBox(solid, block, x, z, 14, 10, 9, 0xd2c7ad);
  facade(solid, lit, block, x, z, 14, 10, h, { first: 2, floor: 3.1, winW: 1.2, winH: 1.7, gap: 1.5, lit: 0.5, salt: 97, door: 's' });
  const tower = placeBox(solid, block, x, z, 5, 5, 4, 0x8a7560, h);
  const roofHeight = Math.min(3.6, safeHeight(x, z, 7, 7) - h - tower);
  if (roofHeight > 0.08) solid.cone(x, h + tower + roofHeight / 2, z, 3.5, roofHeight, 0x78664f, 6);
  detail(solid, x, 0.18, z + 6, 4, 0.3, 5, 0x8c8c88);
  for (let i = -2; i <= 2; i++) tree(solid, block, x + i * 5, block.z + block.depth * 0.27, 0.7);
}

function supermarket(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch): void {
  ground(solid, block, 0x858887);
  const x = block.x, z = block.z - block.depth * 0.22;
  const w = block.width * 0.62, d = block.depth * 0.4;
  const height = placeBox(solid, block, x, z, w, d, 5.8, 0xe5e0d4);
  walls(solid, lit, block, x, z, w, d, height, 91, ['s', 'e', 'w']);
  detail(lit, x, 1.5, z - d / 2 - 0.03, w * 0.52, 1.5, 0.06, COLORS.glass);
  detail(solid, x, 3.4, z - d / 2 - 0.45, w * 0.36, 0.18, 0.9, 0x4383a0);
  for (let i = -2; i <= 2; i++) {
    const px = x + i * Math.min(5, block.width * 0.09);
    detail(solid, px, 0.02, block.z + block.depth * 0.28, 0.11, 0.04, block.depth * 0.24, 0xdedbd0);
    detail(solid, px, 0.45, block.z + block.depth * 0.39, 2.1, 0.9, 4, i % 2 ? 0xd7d8d0 : 0x313638);
  }
}

function petrol(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch): void {
  ground(solid, block, 0x676d6d);
  const x = block.x, z = block.z - block.depth * 0.12;
  const shopW = Math.min(12, block.width * 0.3), shopD = Math.min(8, block.depth * 0.28);
  const shopH = placeBox(solid, block, x - block.width * 0.22, z - block.depth * 0.22, shopW, shopD, 4.5, 0xded6c5);
  walls(solid, lit, block, x - block.width * 0.22, z - block.depth * 0.22, shopW, shopD, shopH, 101);
  const canopyX = x + block.width * 0.13, canopyZ = z + block.depth * 0.08;
  const canopyW = Math.min(15, block.width * 0.42), canopyD = Math.min(8, block.depth * 0.35);
  const canopyH = Math.min(0.45, safeHeight(canopyX, canopyZ, canopyW, canopyD) - 4);
  if (canopyH > 0.08) {
    detail(solid, canopyX, 4 + canopyH / 2, canopyZ, canopyW, canopyH, canopyD, 0xd5493d);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) detail(solid, canopyX + sx * canopyW * 0.42, 2, canopyZ + sz * canopyD * 0.38, 0.22, 4, 0.22, 0xe3dfd5);
  }
  for (let i = -1; i <= 1; i++) {
    const pumpX = canopyX + i * canopyW * 0.3;
    detail(solid, pumpX, 0.65, canopyZ, 0.7, 1.3, 0.65, 0xf1eee3);
    detail(solid, pumpX, 1.1, canopyZ - 0.34, 0.38, 0.3, 0.06, 0x384448);
  }
}

function football(block: CityBlock, solid: ExteriorBatch): void {
  ground(solid, block, 0x5e8b56);
  const w = block.width * 0.68, d = block.depth * 0.58;
  detail(solid, block.x, 0.02, block.z, w, 0.04, d, 0x54834e);
  for (const z of [-1, 1]) {
    detail(solid, block.x, 0.08, block.z + z * d * 0.47, w * 0.14, 0.16, 0.16, COLORS.white);
    for (const x of [-1, 1]) detail(solid, block.x + x * w * 0.07, 0.08, block.z + z * d * 0.47, 0.16, 0.16, d * 0.08, COLORS.white);
  }
  detail(solid, block.x, 0.045, block.z, w, 0.03, 0.08, COLORS.white);
  detail(solid, block.x, 0.045, block.z, 0.08, 0.03, d, COLORS.white);
}

function distantBlock(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch): void {
  const ring = Math.max(Math.abs(block.col), Math.abs(block.row));
  const green = block.kind === 'houses' || block.kind === 'park';
  const base = green ? 0x729463 : 0x999a8d;
  const width = Math.max(1, block.width - 12), depth = Math.max(1, block.depth - 12);
  detail(solid, block.x, -0.07, block.z, width, 0.14, depth, base);
  const patches = ring <= 8 ? 4 : 2;
  for (let index = 0; index < patches; index++) {
    const x = block.x + (index % 2 ? 0.23 : -0.23) * width;
    const z = block.z + (index < 2 ? -0.23 : 0.23) * depth;
    detail(solid, x, 0.006, z, width * 0.34, 0.012, depth * 0.34,
      rand(block, index + 751) > 0.5 ? (green ? 0x7b9d6a : 0xb0aa98) : (green ? 0x668b5b : 0x8d9188));
  }
  if (block.kind === 'park') {
    detail(solid, block.x, 0.025, block.z, width * 0.7, 0.04, 1.8, COLORS.path);
    for (const side of [-1, 1]) tree(solid, block, block.x + side * width * 0.22, block.z, 0.85);
    return;
  }
  const count = ring <= 8 ? 2 : 1;
  const height = block.kind === 'downtown' ? 17 : block.kind === 'apartments' ? 9 : block.kind === 'houses' ? 4 : 5;
  for (let index = 0; index < count; index++) {
    const x = block.x + (index === 0 ? -1 : 1) * width * 0.23;
    const z = block.z + (index === 0 ? -1 : 1) * depth * 0.16;
    const w = Math.min(12, width * 0.2), d = Math.min(9, depth * 0.2);
    const h = placeBox(solid, block, x, z, w, d, height, green ? COLORS.cream : COLORS.blue);
    if (h > 1) placeBox(solid, block, x, z, w * 1.04, d * 1.04, 0.24, COLORS.roof, h);
    if (h > 2.5) facade(solid, lit, block, x, z, w, d, h, { first: 1.6, floor: 3, winW: 1.1, winH: 1.1, gap: 1.8, lit: 0.45, salt: 611 + index });
  }
}

function fill(block: CityBlock, solid: ExteriorBatch, lit: ExteriorBatch, shadows: Shadow[]): void {
  if (Math.max(Math.abs(block.col), Math.abs(block.row)) > 3) {
    distantBlock(block, solid, lit);
    return;
  }
  switch (block.kind) {
    case 'houses': houseBlock(block, solid, lit, shadows); break;
    case 'apartments': apartments(block, solid, lit, shadows); break;
    case 'downtown': downtown(block, solid, lit, shadows); break;
    case 'shops': shops(block, solid, lit); break;
    case 'school': school(block, solid, lit, shadows); break;
    case 'townhall': townHall(block, solid, lit); break;
    case 'supermarket': supermarket(block, solid, lit); break;
    case 'petrol': petrol(block, solid, lit); break;
    case 'park': park(block, solid); break;
    case 'football': football(block, solid); break;
    case 'office': break;
  }
}

export function buildBlocks(plan: CityPlan, solid: ExteriorBatch, lit: ExteriorBatch): { shadows: Shadow[] } {
  const shadows: Shadow[] = [];
  for (const block of plan.blocks) if (block.kind !== 'office') fill(block, solid, lit, shadows);
  return { shadows };
}
