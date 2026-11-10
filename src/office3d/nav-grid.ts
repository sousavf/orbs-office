import { FURNITURE, SEAT_FOOTPRINTS, WALLS, footprintRect, wallRect } from './layout';
import type { Rect, Vec2 } from './layout.types';
import { OFFICE } from './layout-rooms';

export const CELL = 0.25;
/** How far a walking figure's centre stays from any footprint or wall face: 0.15 m of air plus the body. */
export const CLEARANCE = 0.2;

interface Cell {
  readonly col: number;
  readonly row: number;
}

const DIRECTIONS: readonly Cell[] = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
  { col: 1, row: 1 },
  { col: 1, row: -1 },
  { col: -1, row: 1 },
  { col: -1, row: -1 },
];

/** Edges are stored once, from the cell with the smaller index: east, south, south-east, south-west. */
const EDGE_DIRECTIONS: readonly Cell[] = [
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
  { col: -1, row: 1 },
];

const SQRT2 = Math.SQRT2;
const EPSILON = 1e-9;
const BUCKET = 2;
/** Half-size of the box a bot standing in the way blocks while a walker plans around it. */
const AVOID_HALF = 0.35;

function inflate(rect: Rect, by: number): Rect {
  return { x0: rect.x0 - by, z0: rect.z0 - by, x1: rect.x1 + by, z1: rect.z1 + by };
}

function strictlyInside(p: Vec2, r: Rect): boolean {
  return p.x > r.x0 + EPSILON && p.x < r.x1 - EPSILON && p.z > r.z0 + EPSILON && p.z < r.z1 - EPSILON;
}

/** True when the segment passes through the open interior of the rectangle (grazing an edge is fine). */
function crosses(a: Vec2, b: Vec2, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: readonly (readonly [number, number, number, number])[] = [
    [a.x, b.x - a.x, r.x0, r.x1],
    [a.z, b.z - a.z, r.z0, r.z1],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (p <= lo + EPSILON || p >= hi - EPSILON) return false;
      continue;
    }
    const ta = (lo - p) / d;
    const tb = (hi - p) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 >= t1 - EPSILON) return false;
  }
  return true;
}

/** Rectangles bucketed on a coarse grid, to find the few near a point or segment. */
class RectIndex {
  private readonly buckets = new Map<number, number[]>();

  constructor(private readonly rects: readonly Rect[]) {
    rects.forEach((rect, index) => {
      for (let bx = Math.floor(rect.x0 / BUCKET); bx <= Math.floor(rect.x1 / BUCKET); bx++) {
        for (let bz = Math.floor(rect.z0 / BUCKET); bz <= Math.floor(rect.z1 / BUCKET); bz++) {
          const key = bx * 4096 + bz;
          const list = this.buckets.get(key);
          if (list === undefined) this.buckets.set(key, [index]);
          else list.push(index);
        }
      }
    });
  }

  /** Indices of rectangles whose buckets overlap the box; may include a few that do not touch it. */
  near(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const found = new Set<number>();
    for (let bx = Math.floor(minX / BUCKET); bx <= Math.floor(maxX / BUCKET); bx++) {
      for (let bz = Math.floor(minZ / BUCKET); bz <= Math.floor(maxZ / BUCKET); bz++) {
        for (const index of this.buckets.get(bx * 4096 + bz) ?? []) found.add(index);
      }
    }
    return [...found];
  }

  get(index: number): Rect | undefined {
    return this.rects[index];
  }
}

/** What one search ignores or adds: chairs it starts or ends in, and boxes around bots in the way. */
interface Query {
  readonly exempt: ReadonlySet<number>;
  readonly temp: readonly Rect[];
}

interface HeapItem {
  readonly node: number;
  readonly priority: number;
}

/** Minimal binary min-heap keyed by priority. */
class MinHeap {
  private readonly items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: number, priority: number): void {
    this.items.push({ node, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorityAt(parent) <= this.priorityAt(i)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined || last === undefined) return undefined;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.priorityAt(l) < this.priorityAt(smallest)) smallest = l;
        if (r < this.items.length && this.priorityAt(r) < this.priorityAt(smallest)) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top.node;
  }

  private priorityAt(i: number): number {
    return this.items[i]?.priority ?? Infinity;
  }

  private swap(a: number, b: number): void {
    const x = this.items[a];
    const y = this.items[b];
    if (x === undefined || y === undefined) return;
    this.items[a] = y;
    this.items[b] = x;
  }
}

/**
 * 0.25 m walkability grid over exact obstacle rectangles. Every blocker (furniture footprint, chair,
 * wall piece) is grown by CLEARANCE; a cell is free when its centre is outside all of them, and a step
 * between two cells is open when the segment between the centres crosses none. Smoothing and the final
 * hops to the exact start and goal use the same exact segment test, so no path touches a blocker.
 *
 * Chairs block every walker except one that starts or ends inside the chair, so a bot can sit down
 * but nobody cuts through someone else's seat. Doorways are simply gaps between wall pieces.
 */
export class NavGrid {
  readonly cols = Math.round(OFFICE.width / CELL);
  readonly rows = Math.round(OFFICE.depth / CELL);
  private readonly solids: RectIndex;
  private readonly chairs: RectIndex;
  private readonly blocked = new Uint8Array(this.cols * this.rows);
  private readonly edgeBlocked = new Uint8Array(this.cols * this.rows * EDGE_DIRECTIONS.length);
  /** Chair indices that cover a cell centre, or an edge, keyed like `blocked` and `edgeBlocked`. */
  private readonly chairCells = new Map<number, number[]>();
  private readonly chairEdges = new Map<number, number[]>();

  constructor() {
    const solids: Rect[] = [
      ...FURNITURE.filter((item) => item.blocks).map((item) => inflate(footprintRect(item), CLEARANCE)),
      ...WALLS.map((wall) => inflate(wallRect(wall), CLEARANCE)),
    ];
    const chairs = SEAT_FOOTPRINTS.map((seat) => inflate(seat.rect, CLEARANCE));
    this.solids = new RectIndex(solids);
    this.chairs = new RectIndex(chairs);
    this.raster();
  }

  /** True when a figure may stand at `p`. */
  isWalkable(p: Vec2): boolean {
    return this.pointFree(p, EMPTY_QUERY);
  }

  /** True when a figure may walk the straight segment from `a` to `b`. */
  segmentClear(a: Vec2, b: Vec2): boolean {
    return this.clear(a, b, EMPTY_QUERY);
  }

  /**
   * Shortest path of waypoints from `from` to `to` (both kept exactly), or null when none exists.
   * A chair containing `from` or `to` is open to this walk. `avoid` lists bots to route around.
   */
  findPath(from: Vec2, to: Vec2, avoid: readonly Vec2[] = []): Vec2[] | null {
    const temp = avoid
      .map((p) => ({ x0: p.x - AVOID_HALF, z0: p.z - AVOID_HALF, x1: p.x + AVOID_HALF, z1: p.z + AVOID_HALF }))
      .filter((box) => !strictlyInside(from, box) && !strictlyInside(to, box));
    const exempt = new Set<number>();
    for (const point of [from, to]) {
      for (const index of this.chairs.near(point.x, point.z, point.x, point.z)) {
        const rect = this.chairs.get(index);
        if (rect !== undefined && strictlyInside(point, rect)) exempt.add(index);
      }
    }
    const query: Query = { exempt, temp };
    if (!this.pointFree(from, query) || !this.pointFree(to, query)) return null;
    if (this.clear(from, to, query)) return [from, to];
    const start = this.anchor(from, query);
    const goal = this.anchor(to, query);
    if (start === null || goal === null) return null;
    const cells = this.search(start, goal, query);
    if (cells === null) return null;
    return this.smooth([from, ...cells.map((cell) => this.centerOf(cell)), to], query);
  }

  private cellOf(p: Vec2): Cell {
    return {
      col: Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / CELL))),
      row: Math.min(this.rows - 1, Math.max(0, Math.floor(p.z / CELL))),
    };
  }

  private centerOf(cell: Cell): Vec2 {
    return { x: (cell.col + 0.5) * CELL, z: (cell.row + 0.5) * CELL };
  }

  private inGrid(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  private pointFree(p: Vec2, query: Query): boolean {
    if (p.x < 0 || p.z < 0 || p.x > OFFICE.width || p.z > OFFICE.depth) return false;
    for (const index of this.solids.near(p.x, p.z, p.x, p.z)) {
      const rect = this.solids.get(index);
      if (rect !== undefined && strictlyInside(p, rect)) return false;
    }
    for (const index of this.chairs.near(p.x, p.z, p.x, p.z)) {
      const rect = this.chairs.get(index);
      if (rect !== undefined && !query.exempt.has(index) && strictlyInside(p, rect)) return false;
    }
    return !query.temp.some((box) => strictlyInside(p, box));
  }

  /** The segment crosses no solid, no chair outside the exemptions and no temporary box. */
  private clear(a: Vec2, b: Vec2, query: Query): boolean {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minZ = Math.min(a.z, b.z);
    const maxZ = Math.max(a.z, b.z);
    for (const index of this.solids.near(minX, minZ, maxX, maxZ)) {
      const rect = this.solids.get(index);
      if (rect !== undefined && crosses(a, b, rect)) return false;
    }
    for (const index of this.chairs.near(minX, minZ, maxX, maxZ)) {
      const rect = this.chairs.get(index);
      if (rect !== undefined && !query.exempt.has(index) && crosses(a, b, rect)) return false;
    }
    return !query.temp.some((box) => crosses(a, b, box));
  }

  private cellFree(col: number, row: number, query: Query): boolean {
    if (!this.inGrid(col, row)) return false;
    const index = row * this.cols + col;
    if (this.blocked[index] === 1) return false;
    if (!(this.chairCells.get(index) ?? []).every((chair) => query.exempt.has(chair))) return false;
    if (query.temp.length === 0) return true;
    const centre = this.centerOf({ col, row });
    return !query.temp.some((box) => strictlyInside(centre, box));
  }

  /** The nearest free cell whose centre can be reached from `p` in a straight line. */
  private anchor(p: Vec2, query: Query): Cell | null {
    const home = this.cellOf(p);
    let best: Cell | null = null;
    let bestDistance = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cell = { col: home.col + dc, row: home.row + dr };
        if (!this.cellFree(cell.col, cell.row, query)) continue;
        const centre = this.centerOf(cell);
        const distance = Math.hypot(centre.x - p.x, centre.z - p.z);
        if (distance < bestDistance && this.clear(p, centre, query)) {
          best = cell;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  private edgeOpen(col: number, row: number, dc: number, dr: number, query: Query): boolean {
    let c = col;
    let r = row;
    let ec = dc;
    let er = dr;
    if (er < 0 || (er === 0 && ec < 0)) {
      c += ec;
      r += er;
      ec = -ec;
      er = -er;
    }
    const key = (r * this.cols + c) * EDGE_DIRECTIONS.length + EDGE_DIRECTIONS.findIndex((d) => d.col === ec && d.row === er);
    if (this.edgeBlocked[key] === 1) return false;
    if (!(this.chairEdges.get(key) ?? []).every((chair) => query.exempt.has(chair))) return false;
    if (query.temp.length === 0) return true;
    return this.clear(this.centerOf({ col, row }), this.centerOf({ col: col + dc, row: row + dr }), { exempt: query.exempt, temp: query.temp });
  }

  private search(start: Cell, goal: Cell, query: Query): Cell[] | null {
    const cols = this.cols;
    const total = cols * this.rows;
    const cost = new Float32Array(total).fill(Infinity);
    const parent = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const heap = new MinHeap();
    const startIndex = start.row * cols + start.col;
    const goalIndex = goal.row * cols + goal.col;
    cost[startIndex] = 0;
    heap.push(startIndex, 0);

    const heuristic = (col: number, row: number): number => {
      const dx = Math.abs(col - goal.col);
      const dy = Math.abs(row - goal.row);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };

    for (let current = heap.pop(); current !== undefined; current = heap.pop()) {
      if (closed[current] === 1) continue;
      closed[current] = 1;
      if (current === goalIndex) return this.unwind(parent, goalIndex);
      const col = current % cols;
      const row = Math.floor(current / cols);
      const base = cost[current] ?? Infinity;
      for (const dir of DIRECTIONS) {
        if (!this.cellFree(col + dir.col, row + dir.row, query) || !this.edgeOpen(col, row, dir.col, dir.row, query)) continue;
        const next = (row + dir.row) * cols + col + dir.col;
        const nextCost = base + (dir.col !== 0 && dir.row !== 0 ? SQRT2 : 1);
        if (nextCost >= (cost[next] ?? Infinity)) continue;
        cost[next] = nextCost;
        parent[next] = current;
        heap.push(next, nextCost + heuristic(col + dir.col, row + dir.row));
      }
    }
    return null;
  }

  private unwind(parent: Int32Array, goalIndex: number): Cell[] {
    const path: Cell[] = [];
    for (let index = goalIndex; index !== -1; index = parent[index] ?? -1) {
      path.push({ col: index % this.cols, row: Math.floor(index / this.cols) });
    }
    return path.reverse();
  }

  /** String pulling: skip ahead to the farthest waypoint with a clear straight line from the anchor. */
  private smooth(points: readonly Vec2[], query: Query): Vec2[] {
    const out: Vec2[] = [];
    let anchor = 0;
    while (anchor < points.length) {
      const from = points[anchor];
      if (from === undefined) break;
      out.push(from);
      let far = points.length - 1;
      while (far > anchor + 1) {
        const target = points[far];
        if (target !== undefined && this.clear(from, target, query)) break;
        far--;
      }
      if (far === anchor) break;
      anchor = far;
    }
    return out;
  }

  private raster(): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const centre = this.centerOf({ col, row });
        const index = row * this.cols + col;
        for (const solid of this.solids.near(centre.x, centre.z, centre.x, centre.z)) {
          const rect = this.solids.get(solid);
          if (rect !== undefined && strictlyInside(centre, rect)) this.blocked[index] = 1;
        }
        const covering = this.chairs
          .near(centre.x, centre.z, centre.x, centre.z)
          .filter((chair) => {
            const rect = this.chairs.get(chair);
            return rect !== undefined && strictlyInside(centre, rect);
          });
        if (covering.length > 0) this.chairCells.set(index, covering);
        EDGE_DIRECTIONS.forEach((dir, d) => {
          if (!this.inGrid(col + dir.col, row + dir.row)) {
            this.edgeBlocked[index * EDGE_DIRECTIONS.length + d] = 1;
            return;
          }
          const a = centre;
          const b = this.centerOf({ col: col + dir.col, row: row + dir.row });
          const box = [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)] as const;
          const key = index * EDGE_DIRECTIONS.length + d;
          for (const solid of this.solids.near(...box)) {
            const rect = this.solids.get(solid);
            if (rect !== undefined && crosses(a, b, rect)) this.edgeBlocked[key] = 1;
          }
          const hit = this.chairs.near(...box).filter((chair) => {
            const rect = this.chairs.get(chair);
            return rect !== undefined && crosses(a, b, rect);
          });
          if (hit.length > 0) this.chairEdges.set(key, hit);
        });
      }
    }
  }
}

const EMPTY_QUERY: Query = { exempt: new Set<number>(), temp: [] };
