import { type CityPlan, ROAD_INNER } from './plan';

export interface PathPoint { x: number; z: number; yaw: number }

/** A closed clockwise (seen from above, north up) rectangle with rounded corners. */
export interface Loop {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly radius: number;
  readonly length: number;
}

/** Road centre lines of one ring of streets around the office. */
export interface RoadRing {
  readonly west: number;
  readonly east: number;
  readonly north: number;
  readonly south: number;
  /** Half of the carriageway width of each side. */
  readonly halfWest: number;
  readonly halfEast: number;
  readonly halfNorth: number;
  readonly halfSouth: number;
}

const MAIN_WIDTH = 8;
const SIDE_WIDTH = 5.5;

function halfWidth(main: boolean): number {
  return (main ? MAIN_WIDTH : SIDE_WIDTH) / 2;
}

/** The streets `inset` metres outside the office's four main roads, or null if the plan has none there. */
export function roadRing(plan: CityPlan, inset: number): RoadRing | null {
  const west = plan.xRoads.filter((x) => x <= ROAD_INNER.west - inset).at(-1);
  const east = plan.xRoads.find((x) => x >= ROAD_INNER.east + inset);
  const north = plan.zRoads.filter((z) => z <= ROAD_INNER.north - inset).at(-1);
  const south = plan.zRoads.find((z) => z >= ROAD_INNER.south + inset);
  if (west === undefined || east === undefined || north === undefined || south === undefined) return null;
  return {
    west, east, north, south,
    halfWest: halfWidth(west === ROAD_INNER.west), halfEast: halfWidth(east === ROAD_INNER.east),
    halfNorth: halfWidth(north === ROAD_INNER.north), halfSouth: halfWidth(south === ROAD_INNER.south),
  };
}

export function makeLoop(left: number, right: number, top: number, bottom: number, radius: number): Loop {
  const corner = Math.min(radius, (right - left) / 2, (bottom - top) / 2);
  return { left, right, top, bottom, radius: corner, length: 2 * (right - left + bottom - top) - 8 * corner + 2 * Math.PI * corner };
}

function arc(cx: number, cz: number, radius: number, phase: number, travelled: number, out: PathPoint): void {
  const phi = phase + travelled / radius;
  out.x = cx + radius * Math.cos(phi);
  out.z = cz + radius * Math.sin(phi);
  out.yaw = Math.atan2(Math.sin(phi), -Math.cos(phi));
}

/** Position and heading (as a rotation about y for a model that faces -z) after `distance` metres along the loop. */
export function loopPoint(loop: Loop, distance: number, out: PathPoint): void {
  const { left, right, top, bottom, radius } = loop;
  const sideX = right - left - 2 * radius;
  const sideZ = bottom - top - 2 * radius;
  const quarter = Math.PI * radius / 2;
  let t = ((distance % loop.length) + loop.length) % loop.length;
  if (t < sideX) { out.x = left + radius + t; out.z = top; out.yaw = -Math.PI / 2; return; }
  t -= sideX;
  if (t < quarter) { arc(right - radius, top + radius, radius, -Math.PI / 2, t, out); return; }
  t -= quarter;
  if (t < sideZ) { out.x = right; out.z = top + radius + t; out.yaw = Math.PI; return; }
  t -= sideZ;
  if (t < quarter) { arc(right - radius, bottom - radius, radius, 0, t, out); return; }
  t -= quarter;
  if (t < sideX) { out.x = right - radius - t; out.z = bottom; out.yaw = Math.PI / 2; return; }
  t -= sideX;
  if (t < quarter) { arc(left + radius, bottom - radius, radius, Math.PI / 2, t, out); return; }
  t -= quarter;
  out.x = left; out.z = bottom - radius - t; out.yaw = 0;
}
