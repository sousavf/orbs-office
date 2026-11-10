/** Pure, fixed-seed street and land-use plan. Coordinates are metres in the office world. */
export const CITY_CENTRE = { x: 25, z: 12 } as const;
export const OFFICE_PLOT = { x0: 0, x1: 50, z0: 0, z1: 24 } as const;
export const ROAD_INNER = { west: -9, east: 59, north: -9, south: 34 } as const;
export const CITY_SEED = 0x0b51ce;
export const ISOMETRIC_PITCH = Math.atan(1 / Math.SQRT2);

export type BlockKind = 'office' | 'houses' | 'apartments' | 'downtown' | 'shops' | 'school' | 'townhall' | 'supermarket' | 'petrol' | 'park' | 'football';
export interface CityBlock {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly col: number;
  readonly row: number;
  readonly kind: BlockKind;
}
export interface CityPlan {
  readonly halfExtent: number;
  readonly step: number;
  readonly xRoads: readonly number[];
  readonly zRoads: readonly number[];
  readonly blocks: readonly CityBlock[];
}

export function hashCity(a: number, b: number, salt = 0): number {
  let n = (CITY_SEED ^ Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ salt) | 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 0x1_0000_0000;
}

/** Distance from a footprint to the occupied office rectangle, including touching as zero. */
export function distanceFromOffice(x: number, z: number, width: number, depth: number): number {
  const dx = Math.max(OFFICE_PLOT.x0 - (x + width / 2), (x - width / 2) - OFFICE_PLOT.x1, 0);
  const dz = Math.max(OFFICE_PLOT.z0 - (z + depth / 2), (z - depth / 2) - OFFICE_PLOT.z1, 0);
  return Math.hypot(dx, dz);
}

/** This conservative limit keeps an object below the office floor silhouette in all four headings. */
export function safeHeight(x: number, z: number, width: number, depth: number): number {
  return Math.max(0, distanceFromOffice(x, z, width, depth) * Math.tan(ISOMETRIC_PITCH) - 0.7);
}

function roadStep(index: number): number {
  return 32 * 2 ** Math.floor((index - 1) / 3);
}

function roads(west: number, east: number, halfExtent: number, centre: number): number[] {
  const result = [west, east];
  let left = west;
  let right = east;
  for (let n = 1; left > centre - halfExtent - 64; n++) {
    left -= roadStep(n);
    result.push(left);
  }
  for (let n = 1; right < centre + halfExtent + 64; n++) {
    right += roadStep(n);
    result.push(right);
  }
  return result.sort((a, b) => a - b);
}

function kindAt(col: number, row: number): BlockKind {
  if (col === 0 && row === 0) return 'office';
  if (col === 0 && row === -1) return 'school';
  if (col === 0 && row === 1) return 'shops';
  if (col === -1 && row === 0) return 'park';
  if (col === 1 && row === 0) return 'houses';
  if (col === -2 && row === 1) return 'townhall';
  if (col === 2 && row === -1) return 'supermarket';
  if (col === 2 && row === 1) return 'petrol';
  if (col === -2 && row === -2) return 'football';
  if (col === 2 && row === 2) return 'park';
  const distance = Math.hypot(col, row);
  const value = hashCity(col, row);
  if (distance >= 3 && value < 0.25) return 'downtown';
  if (distance >= 2 && value < 0.5) return 'apartments';
  if (value < 0.58) return 'shops';
  if (value < 0.67) return 'park';
  return 'houses';
}

/** Builds enough blocks past the camera envelope to hide the city edge and fade. */
export function makeCityPlan(halfExtent: number): CityPlan {
  const step = 32;
  const xRoads = roads(ROAD_INNER.west, ROAD_INNER.east, halfExtent + 45, CITY_CENTRE.x);
  const zRoads = roads(ROAD_INNER.north, ROAD_INNER.south, halfExtent + 45, CITY_CENTRE.z);
  const centreColumn = xRoads.indexOf(ROAD_INNER.west);
  const centreRow = zRoads.indexOf(ROAD_INNER.north);
  const blocks: CityBlock[] = [];
  for (let xi = 0; xi < xRoads.length - 1; xi++) {
    const x0 = xRoads[xi] ?? 0;
    const x1 = xRoads[xi + 1] ?? 0;
    const col = xi - centreColumn;
    for (let zi = 0; zi < zRoads.length - 1; zi++) {
      const z0 = zRoads[zi] ?? 0;
      const z1 = zRoads[zi + 1] ?? 0;
      const row = zi - centreRow;
      blocks.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0, col, row, kind: kindAt(col, row) });
    }
  }
  return { halfExtent, step, xRoads, zRoads, blocks };
}
