import { CHAIR_SIZE, HALF_PI, type SeatFootprint, piece, seatFootprint, unit, yawOf } from './layout-kit';
import type {
  Bed,
  Furniture,
  GameSpot,
  GamesLayout,
  LunchSeat,
  Rect,
  SeatSpot,
  Vec2,
  Vec3,
} from './layout.types';

/** Height a figure is raised to sit on a sofa cushion or a dining chair. */
export const SOFA_LIFT = 0.26;
export const DINING_LIFT = 0.2;

function facingSpot(pos: Vec2, fx: number, fz: number): GameSpot {
  const facing = unit({ x: 0, z: 0 }, { x: fx, z: fz });
  return { pos, facing, facingYaw: yawOf(facing) };
}

/** Seats along a sofa's width; the sofa piece is `blocks: false` and these footprints stand in for it. */
function sofaSeats(idPrefix: string, sofa: Furniture, count: number): { seats: SeatSpot[]; footprints: SeatFootprint[] } {
  const cos = Math.round(Math.cos(sofa.rotY));
  const sin = Math.round(Math.sin(sofa.rotY));
  const pitch = sofa.width / count;
  const seats: SeatSpot[] = [];
  const footprints: SeatFootprint[] = [];
  const facing = { x: sin, z: cos };
  for (let i = 0; i < count; i++) {
    const lx = (i - (count - 1) / 2) * pitch;
    const lz = 0.08;
    const pos = { x: sofa.x + lx * cos + lz * sin, z: sofa.z - lx * sin + lz * cos };
    seats.push({ id: `${idPrefix}-${i}`, pos, facing, facingYaw: yawOf(facing), lift: SOFA_LIFT });
    const turned = Math.abs(sin) > 0.5;
    footprints.push(seatFootprint(
      { x: sofa.x + lx * cos, z: sofa.z - lx * sin },
      turned ? sofa.depth : pitch,
      turned ? pitch : sofa.depth,
    ));
  }
  return { seats, footprints };
}

// ---- Hall -------------------------------------------------------------------------------------

const hallSofaA = piece('sofa', 30.65, 2.4, HALF_PI, 2.4, 0.8, false);
const hallSofaB = piece('sofa', 33.35, 2.4, -HALF_PI, 2.4, 0.8, false);
/** The workspace's east-end sofa, kept from the original layout. */
export const WORKSPACE_SOFA = piece('sofa', 29.5, 6, -HALF_PI, 2.2, 0.8, false);

const loungeParts = [
  sofaSeats('lounge-work', WORKSPACE_SOFA, 3),
  sofaSeats('lounge-hall-a', hallSofaA, 3),
  sofaSeats('lounge-hall-b', hallSofaB, 3),
];

export const LOUNGE_SEATS: readonly SeatSpot[] = loungeParts.flatMap((part) => part.seats);

/** Water-cooler stand spots: where a bot stands to fill a cup, facing the cooler. */
export interface CoolerSpot extends GameSpot {
  readonly id: string;
}

const HALL_COOLER = piece('cooler', 33.6, 11, -HALF_PI, 0.45, 0.45);
const WORK_COOLER = piece('cooler', 28.4, 11.3, Math.PI, 0.45, 0.45);

export const COOLER_SPOTS: readonly CoolerSpot[] = [
  { id: 'cooler-lobby', ...facingSpot({ x: 13.5, z: 13.7 }, 0, -1) },
  { id: 'cooler-hall', ...facingSpot({ x: 32.65, z: 11 }, 1, 0) },
  { id: 'cooler-work', ...facingSpot({ x: 28.4, z: 10.35 }, 0, 1) },
];

export function hallPieces(): Furniture[] {
  return [
    hallSofaA,
    hallSofaB,
    piece('coffee-table', 32, 2.4, HALF_PI, 1.2, 0.6),
    piece('rug', 32, 2.4, 0, 3.0, 3.0, false, 1),
    piece('floor-lamp', 30.65, 0.7, 0, 0.4, 0.4),
    piece('plant', 33.35, 0.75, 0, 0.5, 0.5, true, 2),
    HALL_COOLER,
    piece('rug', 32, 11, 0, 1.6, 2.6, false, 3),
    piece('plant', 33.35, 7.5, 0, 0.5, 0.5, true, 5),
    piece('plant', 30.65, 23.25, 0, 0.5, 0.5, true, 4),
    piece('plant', 33.35, 23.25, 0, 0.5, 0.5, true, 1),
    piece('door-mat', 33.3, 4.7, HALF_PI, 1.6, 0.8, false),
    piece('door-mat', 33.3, 17.3, HALF_PI, 1.6, 0.8, false),
  ];
}

// ---- Dormitory --------------------------------------------------------------------------------

export const BUNK_SIZE = { width: 1.0, depth: 2.0 } as const;
const BUNK_PAIRS = 5;
const PAIR_PITCH = 3.0;
const PAIR_START_X = 34.45;
const NORTH_ROW_Z = 1.15;
const SOUTH_ROW_Z = 7.85;
/** Height of the lower and upper mattress tops. */
export const MATTRESS_Y = { lower: 0.46, upper: 1.38 } as const;

interface Bunk {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  /** Rotation of the mesh: 0 puts the head at -z (north wall), PI at +z (south wall). */
  readonly rotY: number;
}

function bunks(): Bunk[] {
  const out: Bunk[] = [];
  for (const [row, z, rotY] of [[0, NORTH_ROW_Z, 0], [1, SOUTH_ROW_Z, Math.PI]] as const) {
    for (let pair = 0; pair < BUNK_PAIRS; pair++) {
      const x0 = PAIR_START_X + pair * PAIR_PITCH;
      for (const offset of [0.5, 1.9]) {
        out.push({ index: out.length, x: x0 + offset, z, rotY: row === 0 ? 0 : rotY });
      }
    }
  }
  return out;
}

export const BUNKS: readonly Bunk[] = bunks();

function bedsFor(bunk: Bunk): Bed[] {
  const toFoot = bunk.rotY === 0 ? 1 : -1;
  const yaw = bunk.rotY;
  const aisleZ = bunk.z + toFoot * (BUNK_SIZE.depth / 2 + 0.55);
  return (['lower', 'upper'] as const).map((level) => {
    const y = MATTRESS_Y[level];
    return {
      id: `bed-${bunk.index}-${level === 'lower' ? 'l' : 'u'}`,
      bunk: bunk.index,
      level,
      position: { x: bunk.x, y, z: bunk.z + toFoot * 0.02 },
      yaw,
      approach: { x: bunk.x + (level === 'lower' ? -0.22 : 0.22), z: aisleZ },
      head: { x: bunk.x, y: y + 0.13, z: bunk.z - toFoot * 0.62 },
    };
  });
}

/** Two beds per bunk, ordered bunk by bunk (lower, then upper). One bed per desk and then some. */
export const BEDS: readonly Bed[] = BUNKS.flatMap(bedsFor);

export interface NightLamp {
  readonly id: string;
  readonly position: Vec3;
}

const NIGHTSTAND_SIZE = 0.4;
const NIGHTSTAND_LAMP_Y = 0.6;

function nightstands(): Furniture[] {
  const out: Furniture[] = [];
  for (const z of [0.3, 8.7]) {
    for (let pair = 0; pair < BUNK_PAIRS; pair++) {
      out.push(piece('nightstand', PAIR_START_X + pair * PAIR_PITCH + 1.2, z, z < 4 ? 0 : Math.PI, NIGHTSTAND_SIZE, NIGHTSTAND_SIZE));
    }
  }
  return out;
}

const NIGHTSTANDS = nightstands();

/** Small bedside lamps, for the later lighting step. */
export const DORM_LAMPS: readonly NightLamp[] = NIGHTSTANDS.map((stand, index) => ({
  id: `lamp-${index}`,
  position: { x: stand.x, y: NIGHTSTAND_LAMP_Y + 0.14, z: stand.z },
}));

export function dormPieces(): Furniture[] {
  return [
    ...BUNKS.map((b) => piece('bunk-bed', b.x, b.z, b.rotY, BUNK_SIZE.width, BUNK_SIZE.depth)),
    ...NIGHTSTANDS,
    piece('rug', 42, 4.5, 0, 11, 2.0, false, 4),
    piece('dresser', 49.55, 4.5, -HALF_PI, 1.6, 0.5),
    piece('plant', 49.4, 1.0, 0, 0.5, 0.5, true, 3),
    piece('plant', 49.4, 8.0, 0, 0.5, 0.5, true, 0),
    piece('door-mat', 34.9, 5.2, HALF_PI, 1.6, 0.8, false),
  ];
}

// ---- Kitchen ----------------------------------------------------------------------------------

export const LUNCH_TABLE_SIZE = { width: 0.9, length: 4.0 } as const;
const LUNCH_COLUMNS: readonly number[] = [22.4, 26.6];
const LUNCH_ROWS: readonly number[] = [15.7, 20.7];
const SEAT_OFFSET_X = 0.9;
const SEAT_PITCH = 0.8;
const SEATS_PER_SIDE = 5;

export interface LunchTable {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export const LUNCH_TABLES: readonly LunchTable[] = LUNCH_ROWS.flatMap((z, row) =>
  LUNCH_COLUMNS.map((x, col) => ({ id: `table-${row * LUNCH_COLUMNS.length + col}`, x, z })),
);

function lunchSeats(): LunchSeat[] {
  const out: LunchSeat[] = [];
  for (const table of LUNCH_TABLES) {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < SEATS_PER_SIDE; i++) {
        const facing = { x: -side, z: 0 };
        out.push({
          id: `lunch-${out.length}`,
          tableId: table.id,
          position: { x: table.x + side * SEAT_OFFSET_X, z: table.z + (i - (SEATS_PER_SIDE - 1) / 2) * SEAT_PITCH },
          yaw: yawOf(facing),
          facing,
          lift: DINING_LIFT,
        });
      }
    }
  }
  return out;
}

/** Long lunch tables, five chairs a side: as many seats as desks. */
export const LUNCH_SEATS: readonly LunchSeat[] = lunchSeats();

export function kitchenPieces(): Furniture[] {
  const stools = (cx: number, cz: number, offsets: readonly (readonly [number, number])[]): Furniture[] =>
    offsets.map(([dx, dz]) => piece('stool', cx + dx, cz + dz, 0, 0.4, 0.4));
  const sofa = piece('sofa', 17.55, 21, HALF_PI, 2.4, 0.8);
  return [
    piece('counter', 29.6, 13.5, -HALF_PI, 2, 0.6),
    piece('coffee-machine', 29.6, 13.0, -HALF_PI, 0.4, 0.4, false),
    piece('sink-counter', 29.6, 18.5, -HALF_PI, 2, 0.6),
    piece('fridge', 29.55, 20.4, -HALF_PI, 1, 0.7),
    piece('counter', 29.6, 22.2, -HALF_PI, 2, 0.6),
    piece('counter', 19, 12.5, 0, 2, 0.5),
    ...LUNCH_TABLES.map((table) => piece('lunch-table', table.x, table.z, 0, LUNCH_TABLE_SIZE.width, LUNCH_TABLE_SIZE.length)),
    piece('round-table', 19.7, 15, 0, 1.2, 1.2),
    ...stools(19.7, 15, [[-1, 0], [0, -1], [0, 1]]),
    piece('round-table', 19.5, 18.2, 0, 1, 1),
    ...stools(19.5, 18.2, [[-1, 0], [0, 1]]),
    piece('rug', 19.2, 21, 0, 2.6, 3.0, false, 6),
    sofa,
    piece('coffee-table', 19.0, 21, HALF_PI, 1.2, 0.6),
    piece('floor-lamp', 17.7, 23.2, 0, 0.4, 0.4),
    piece('plant', 17.75, 17.25, 0, 0.5, 0.5, true, 3),
    piece('plant', 20.2, 23.3, 0, 0.5, 0.5, true, 5),
    piece('plant', 29.3, 23.3, 0, 0.5, 0.5, true, 1),
    piece('plant', 28.6, 12.75, 0, 0.5, 0.5, true, 5),
  ];
}

// ---- Games room -------------------------------------------------------------------------------

export const POOL = { x: 42.5, z: 14.2, width: 2.7, depth: 1.5, surfaceY: 0.82 } as const;
export const FOOSBALL = { x: 45.8, z: 19.2, width: 1.5, depth: 0.8, surfaceY: 0.9 } as const;
/** Handles stick out of the long sides; this is how far the footprint reaches past the table body. */
const FOOSBALL_HANDLE_REACH = 0.2;
export const TV = { x: 34.4, z: 20.6, width: 1.3 } as const;
export const TV_SCREEN_Y = 0.99;

const consoleSofa = piece('sofa', 37.9, 20.6, -HALF_PI, 1.7, 0.8, false);
const consoleSeats = sofaSeats('console', consoleSofa, 2);

export const CONSOLE_SEATS: readonly SeatSpot[] = consoleSeats.seats;

const [consoleSeatA, consoleSeatB] = consoleSeats.seats;
if (consoleSeatA === undefined || consoleSeatB === undefined) throw new Error('Console sofa needs two seats');

export const GAMES: GamesLayout = {
  pool: {
    table: { center: { x: POOL.x, z: POOL.z }, width: POOL.width, depth: POOL.depth, surfaceY: POOL.surfaceY },
    spots: [
      facingSpot({ x: POOL.x - 0.5, z: POOL.z + POOL.depth / 2 + 0.7 }, 0, -1),
      facingSpot({ x: POOL.x + 0.9, z: POOL.z - POOL.depth / 2 - 0.7 }, 0, 1),
    ],
  },
  foosball: {
    table: { center: { x: FOOSBALL.x, z: FOOSBALL.z }, width: FOOSBALL.width, depth: FOOSBALL.depth, surfaceY: FOOSBALL.surfaceY },
    spots: [
      facingSpot({ x: FOOSBALL.x, z: FOOSBALL.z + FOOSBALL.depth / 2 + FOOSBALL_HANDLE_REACH + 0.45 }, 0, -1),
      facingSpot({ x: FOOSBALL.x, z: FOOSBALL.z - FOOSBALL.depth / 2 - FOOSBALL_HANDLE_REACH - 0.45 }, 0, 1),
    ],
  },
  console: {
    screen: { x: TV.x - 0.112, y: TV_SCREEN_Y, z: TV.z },
    screenYaw: HALF_PI,
    seats: [consoleSeatA, consoleSeatB],
  },
};

export function gamesPieces(): Furniture[] {
  const stools = (cx: number, cz: number, offsets: readonly (readonly [number, number])[]): Furniture[] =>
    offsets.map(([dx, dz]) => piece('stool', cx + dx, cz + dz, 0, 0.4, 0.4));
  const handleExtent: Rect = {
    x0: -FOOSBALL.width / 2,
    x1: FOOSBALL.width / 2,
    z0: -FOOSBALL.depth / 2 - FOOSBALL_HANDLE_REACH,
    z1: FOOSBALL.depth / 2 + FOOSBALL_HANDLE_REACH,
  };
  return [
    piece('rug', POOL.x, POOL.z, 0, 5.2, 3.6, false, 0),
    piece('pool-table', POOL.x, POOL.z, 0, POOL.width, POOL.depth),
    piece('cue-rack', 49.65, 12.0, -HALF_PI, 1.0, 0.3),
    piece('foosball-table', FOOSBALL.x, FOOSBALL.z, 0, FOOSBALL.width, FOOSBALL.depth, true, 0, handleExtent),
    piece('rug', 36.7, 20.6, 0, 3.8, 3.0, false, 2),
    piece('tv-stand', TV.x, TV.z, HALF_PI, TV.width, 0.5),
    consoleSofa,
    piece('side-table', 37.9, 22.5, 0, 0.5, 0.5),
    piece('game-shelf', 43.9, 23.65, Math.PI, 1.5, 0.5),
    piece('game-shelf', 45.6, 23.65, Math.PI, 1.5, 0.5),
    piece('round-table', 40.6, 22.0, 0, 1.2, 1.2),
    ...stools(40.6, 22.0, [[-1, 0], [1, 0], [0, -0.95]]),
    piece('plant', 49.4, 9.7, 0, 0.5, 0.5, true, 2),
    piece('plant', 49.4, 23.3, 0, 0.5, 0.5, true, 4),
    piece('plant', 34.7, 23.3, 0, 0.5, 0.5, true, 3),
    piece('plant', 34.75, 14.5, 0, 0.5, 0.5, true, 1),
    piece('floor-lamp', 39.4, 18.9, 0, 0.4, 0.4),
  ];
}

/** Footprints of every seat the wings add to the nav grid's chair list (lunch chairs, sofa cushions). */
export function wingSeatFootprints(): SeatFootprint[] {
  return [
    ...LUNCH_SEATS.map((seat) => seatFootprint(seat.position, CHAIR_SIZE, CHAIR_SIZE)),
    ...loungeParts.flatMap((part) => part.footprints),
    ...consoleSeats.footprints,
  ];
}

export function coolerPieces(): Furniture[] {
  return [WORK_COOLER];
}
