import type { Door, Rect, Room, WallKind, WallSegment, ZoneOrOutside } from './layout.types';

export const OFFICE = {
  width: 50,
  depth: 24,
  wallHeight: 2.6,
  wallThickness: 0.15,
} as const;

/*
 * Top-down plan, x east (0..50), z south (0..24):
 *
 *   x=0      7                      30  34             50
 *   +--------+-----------------------+---+--------------+  z=0
 *   | MEET A | workspace             | H | DORMITORY    |
 *   +--------+  (6 islands + solos)  | A |              |
 *   | MEET B |                       | L +--------------+  z=9
 *   +--------+--+----------+--+------+ L |              |
 *   | MAILROOM | APPROVALS |LOBBY| KITCHEN |  GAMES ROOM |  z=12 / 18
 *   +--------+-------------+--+                          |
 *                                   |  (kitchen and wings reach z=24)
 *                                   +---+--------------+  z=24
 * The entrance gap is in the south wall at x 14..16 (z=18).
 */
export const ROOMS: readonly Room[] = [
  { id: 'workspace', rect: { x0: 7, z0: 0, x1: 30, z1: 12 } },
  { id: 'meeting-a', rect: { x0: 0, z0: 0, x1: 7, z1: 6 } },
  { id: 'meeting-b', rect: { x0: 0, z0: 6, x1: 7, z1: 12 } },
  { id: 'mailroom', rect: { x0: 0, z0: 12, x1: 7, z1: 18 } },
  { id: 'approvals', rect: { x0: 7, z0: 12, x1: 13, z1: 18 } },
  { id: 'corridor', rect: { x0: 13, z0: 12, x1: 17, z1: 18 } },
  { id: 'kitchen', rect: { x0: 17, z0: 12, x1: 30, z1: 24 } },
  { id: 'hall', rect: { x0: 30, z0: 0, x1: 34, z1: 24 } },
  { id: 'dormitory', rect: { x0: 34, z0: 0, x1: 50, z1: 9 } },
  { id: 'games', rect: { x0: 34, z0: 9, x1: 50, z1: 24 } },
];

/** Plan corners of every room; the camera fits these, so the empty corner of the L does not count. */
export const OFFICE_CORNERS: readonly (readonly [number, number])[] = ROOMS.flatMap(({ rect }) => [
  [rect.x0, rect.z0] as const,
  [rect.x1, rect.z0] as const,
  [rect.x0, rect.z1] as const,
  [rect.x1, rect.z1] as const,
]);

export function zoneAt(x: number, z: number): ZoneOrOutside {
  const room = ROOMS.find((r) => x >= r.rect.x0 && x < r.rect.x1 && z >= r.rect.z0 && z < r.rect.z1);
  return room?.id ?? 'outside';
}

export function rectCenter(rect: Rect): { x: number; z: number } {
  return { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 };
}

interface WallRun {
  readonly axis: 'x' | 'z';
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
  readonly kind: WallKind;
  /** [from, to] along the run left open as doorways. */
  readonly gaps: readonly (readonly [number, number])[];
}

const WALL_RUNS: readonly WallRun[] = [
  { axis: 'x', fixed: 0, from: 0, to: 50, kind: 'solid', gaps: [] },
  { axis: 'x', fixed: 18, from: 0, to: 17, kind: 'solid', gaps: [[14, 16]] },
  { axis: 'x', fixed: 24, from: 17, to: 50, kind: 'solid', gaps: [] },
  { axis: 'z', fixed: 0, from: 0, to: 18, kind: 'solid', gaps: [] },
  { axis: 'z', fixed: 50, from: 0, to: 24, kind: 'solid', gaps: [] },
  { axis: 'x', fixed: 6, from: 0, to: 7, kind: 'solid', gaps: [] },
  { axis: 'x', fixed: 12, from: 0, to: 7, kind: 'solid', gaps: [] },
  { axis: 'z', fixed: 7, from: 0, to: 12, kind: 'glass', gaps: [[2.5, 3.5], [8.5, 9.5]] },
  { axis: 'x', fixed: 12, from: 7, to: 30, kind: 'solid', gaps: [[13, 15], [21, 26]] },
  { axis: 'z', fixed: 7, from: 12, to: 18, kind: 'solid', gaps: [[14.5, 15.5]] },
  { axis: 'z', fixed: 17, from: 12, to: 24, kind: 'solid', gaps: [[13, 17]] },
  // Workspace and kitchen to the hall.
  { axis: 'z', fixed: 30, from: 0, to: 24, kind: 'solid', gaps: [[9, 10.6], [15, 16.6]] },
  // Hall to the dormitory (door at z 3.7..5.3) and the games room (door at z 16.5..18.1).
  { axis: 'z', fixed: 34, from: 0, to: 24, kind: 'solid', gaps: [[3.7, 5.3], [16.5, 18.1]] },
  { axis: 'x', fixed: 9, from: 34, to: 50, kind: 'solid', gaps: [] },
];

export const DOORS: readonly Door[] = WALL_RUNS.flatMap((run) =>
  run.gaps.map((gap) => ({ axis: run.axis, fixed: run.fixed, from: gap[0], to: gap[1] })),
);

function breakpoints(run: WallRun): number[] {
  const points = new Set<number>([run.from, run.to]);
  for (const [a, b] of run.gaps) {
    points.add(a);
    points.add(b);
  }
  for (const { rect } of ROOMS) {
    const edges = run.axis === 'x' ? [rect.x0, rect.x1] : [rect.z0, rect.z1];
    for (const edge of edges) if (edge > run.from && edge < run.to) points.add(edge);
  }
  return [...points].sort((a, b) => a - b);
}

function inGap(run: WallRun, mid: number): boolean {
  return run.gaps.some(([a, b]) => mid > a && mid < b);
}

function zonesAround(run: WallRun, mid: number): [ZoneOrOutside, ZoneOrOutside] {
  const probe = 0.3;
  if (run.axis === 'x') return [zoneAt(mid, run.fixed - probe), zoneAt(mid, run.fixed + probe)];
  return [zoneAt(run.fixed - probe, mid), zoneAt(run.fixed + probe, mid)];
}

function buildWalls(): WallSegment[] {
  const segments: WallSegment[] = [];
  for (const run of WALL_RUNS) {
    const points = breakpoints(run);
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i];
      const to = points[i + 1];
      if (from === undefined || to === undefined) continue;
      const mid = (from + to) / 2;
      if (inGap(run, mid)) continue;
      const [sideNeg, sidePos] = zonesAround(run, mid);
      segments.push({ id: segments.length, axis: run.axis, fixed: run.fixed, from, to, kind: run.kind,
        capFrom: from === run.from, capTo: to === run.to, sideNeg, sidePos });
    }
  }
  return segments;
}

export const WALLS: readonly WallSegment[] = buildWalls();

/** Plan rectangle of a wall piece, caps included; the wall mesh and the nav grid both use it. */
export function wallRect(segment: WallSegment): Rect {
  const half = OFFICE.wallThickness / 2;
  const start = segment.from - (segment.capFrom ? half : 0);
  const end = segment.to + (segment.capTo ? half : 0);
  return segment.axis === 'x'
    ? { x0: start, x1: end, z0: segment.fixed - half, z1: segment.fixed + half }
    : { x0: segment.fixed - half, x1: segment.fixed + half, z0: start, z1: end };
}
