import { ExteriorBatch } from './batch';
import { type CityPlan, ROAD_INNER, hashCity, safeHeight } from './plan';

const ROAD = 0x6d6f73;
const PAVEMENT = 0xc4b9a4;
const KERB = 0xe3d2b7;
const MARK = 0xe8dbc1;
const BASE = -0.59;

function slab(batch: ExteriorBatch, x: number, z: number, width: number, depth: number, color: number, y = BASE): void {
  batch.box(x, y, z, width, 0.025, depth, color);
}

export interface StreetDetails {
  readonly lamps: readonly (readonly [number, number])[];
}

/** Continuous streets and footways, including the generous four-road office block. */
export function buildStreets(plan: CityPlan, solid: ExteriorBatch, lit: ExteriorBatch): StreetDetails {
  const lamps: [number, number][] = [];
  const bothSides = [-1, 1] as const;
  const oneSide = [1] as const;
  const minX = (plan.xRoads[0] ?? -100) - plan.step / 2;
  const maxX = (plan.xRoads.at(-1) ?? 100) + plan.step / 2;
  const minZ = (plan.zRoads[0] ?? -100) - plan.step / 2;
  const maxZ = (plan.zRoads.at(-1) ?? 100) + plan.step / 2;
  for (const x of plan.xRoads) {
    const main = x === ROAD_INNER.west || x === ROAD_INNER.east;
    const width = main ? 8 : 5.5;
    slab(solid, x, (minZ + maxZ) / 2, width + 3.6, maxZ - minZ, PAVEMENT, -0.615);
    slab(solid, x, (minZ + maxZ) / 2, width, maxZ - minZ, ROAD);
    for (const side of [-1, 1]) slab(solid, x + side * (width / 2 + 0.17), (minZ + maxZ) / 2, 0.25, maxZ - minZ, KERB, -0.56);
    for (let zi = 0; zi < plan.zRoads.length - 1; zi++) {
      const a = plan.zRoads[zi] ?? 0;
      const b = plan.zRoads[zi + 1] ?? 0;
      for (let z = a + 3; z < b - 3; z += Math.max(8, (b - a) / 2)) slab(solid, x, z, 0.095, 2.6, MARK, -0.55);
      if (main) for (let z = a + 6; z < b - 6; z += Math.max(20, (b - a) / 2)) slab(solid, x, z, 0.38, 7.5, 0xa6ab8b, -0.545);
    }
    for (let zi = 0; zi < plan.zRoads.length - 1; zi++) {
      const a = plan.zRoads[zi] ?? 0;
      const b = plan.zRoads[zi + 1] ?? 0;
      const z = (a + b) / 2;
      for (const side of Math.max(Math.abs(x - 25), Math.abs(z - 12)) > 200 ? oneSide : bothSides) {
        const px = x + side * (width / 2 + 1.25);
        if (safeHeight(px, z, 0.3, 0.3) < 3.15) continue;
        solid.box(px, 0.92, z, 0.11, 3.0, 0.11, 0x646d70);
        lit.box(px, 2.49, z, 0.34, 0.24, 0.34, 0xffc979);
        lamps.push([px, z]);
      }
    }
  }
  for (const z of plan.zRoads) {
    const main = z === ROAD_INNER.north || z === ROAD_INNER.south;
    const width = main ? 8 : 5.5;
    slab(solid, (minX + maxX) / 2, z, maxX - minX, width + 3.6, PAVEMENT, -0.612);
    slab(solid, (minX + maxX) / 2, z, maxX - minX, width, ROAD);
    for (const side of [-1, 1]) slab(solid, (minX + maxX) / 2, z + side * (width / 2 + 0.17), maxX - minX, 0.25, KERB, -0.56);
    for (let xi = 0; xi < plan.xRoads.length - 1; xi++) {
      const a = plan.xRoads[xi] ?? 0;
      const b = plan.xRoads[xi + 1] ?? 0;
      for (let x = a + 3; x < b - 3; x += Math.max(8, (b - a) / 2)) slab(solid, x, z, 2.6, 0.095, MARK, -0.55);
      if (main) for (let x = a + 6; x < b - 6; x += Math.max(20, (b - a) / 2)) slab(solid, x, z, 7.5, 0.38, 0xa6ab8b, -0.545);
    }
    for (let xi = 0; xi < plan.xRoads.length - 1; xi++) {
      const a = plan.xRoads[xi] ?? 0;
      const b = plan.xRoads[xi + 1] ?? 0;
      const x = (a + b) / 2;
      for (const side of Math.max(Math.abs(x - 25), Math.abs(z - 12)) > 200 ? oneSide : bothSides) {
        const pz = z + side * (width / 2 + 1.25);
        if (safeHeight(x, pz, 0.3, 0.3) < 3.15) continue;
        solid.box(x, 0.92, pz, 0.11, 3.0, 0.11, 0x646d70);
        lit.box(x, 2.49, pz, 0.34, 0.24, 0.34, 0xffc979);
        lamps.push([x, pz]);
      }
    }
  }
  for (const x of plan.xRoads) {
    for (const z of plan.zRoads) {
      const main = x === ROAD_INNER.west || x === ROAD_INNER.east || z === ROAD_INNER.north || z === ROAD_INNER.south;
      if (!main) continue;
      if (Math.max(Math.abs(x - 25), Math.abs(z - 12)) > 200) continue;
      for (const side of [-1, 1]) {
        for (let stripe = -2; stripe <= 2; stripe++) {
          slab(solid, x + stripe * 0.7, z + side * 5.1, 0.34, 1.8, MARK, -0.539);
          slab(solid, x + side * 5.1, z + stripe * 0.7, 1.8, 0.34, MARK, -0.538);
        }
      }
      const px = x + 5.1;
      const pz = z + 5.1;
      if (safeHeight(px, pz, 0.4, 0.4) > 3.3) {
        solid.cylinder(px, 0.85, pz, 0.075, 0.075, 2.85, 0x424d50, 5);
        solid.box(px, 2.07, pz, 0.35, 0.8, 0.32, 0x313b3e);
        const red = hashCity(x, z, 23) > 0.5;
        (red ? lit : solid).sphere(px, 2.2, pz - 0.18, 0.1, red ? 0xff453d : 0x353431);
        (red ? solid : lit).sphere(px, 1.92, pz - 0.18, 0.1, red ? 0x303b31 : 0x87bb67);
      }
    }
  }
  for (const [x, z] of [
    [ROAD_INNER.west - plan.step * 3, ROAD_INNER.south + plan.step],
    [ROAD_INNER.east + plan.step * 3, ROAD_INNER.north - plan.step],
  ] as const) {
    solid.cylinder(x, -0.54, z, 2.1, 2.1, 0.1, KERB, 16);
    solid.cylinder(x, -0.43, z, 1.55, 1.55, 0.14, 0x78905e, 12);
    solid.cone(x, 0.22, z, 0.65, 1.1, 0x5f835b, 6);
  }
  // The wide office parcel has a forecourt and a small visitor car park below the south wall.
  slab(solid, 25, 30.1, 53, 3.5, 0xd5c6ab, -0.55);
  slab(solid, 10, 28.2, 22, 2.2, 0x8b8c81, -0.545);
  for (let x = 1; x <= 20; x += 3.7) slab(solid, x, 28.2, 0.08, 2, MARK, -0.525);
  return { lamps };
}
