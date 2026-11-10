import { WALLS, wallRect } from './layout-rooms';
import { DESK_SLOTS, deskPieces, podPieces } from './layout-desks';
import { CHAIR_SIZE, HALF_PI, type SeatFootprint, footprintRect, piece, seat, seatFootprint, yawOf } from './layout-kit';
import {
  POOL,
  WORKSPACE_SOFA,
  coolerPieces,
  dormPieces,
  gamesPieces,
  hallPieces,
  kitchenPieces,
  wingSeatFootprints,
} from './layout-wings';
import type { Furniture, LampSpot, MeetingRoom, Seat, Vec2, WallDecor } from './layout.types';

export { CHAIR_SIZE, footprintRect, yawOf };
export { DESK_SIZE, DESK_SLOTS, ISLANDS, SOLO_DESKS } from './layout-desks';

function seatOf(x: number, z: number, fx: number, fz: number): Seat {
  return seat(x, z, fx, fz);
}

function meetingRoom(id: MeetingRoom['id'], zc: number, doorZ: number): MeetingRoom {
  return {
    id,
    table: { x: 3, z: zc },
    tableWidth: 3,
    tableDepth: 1,
    seats: [
      seatOf(2, zc - 1, 0, 1),
      seatOf(4, zc - 1, 0, 1),
      seatOf(2, zc + 1, 0, -1),
      seatOf(4, zc + 1, 0, -1),
      seatOf(0.5, zc, 1, 0),
      seatOf(5.5, zc, -1, 0),
    ],
    door: { x: 7, z: doorZ },
  };
}

export const MEETING_ROOMS: readonly MeetingRoom[] = [
  meetingRoom('meeting-a', 3, 3),
  meetingRoom('meeting-b', 9, 9),
];

export const ENTRANCE: Vec2 = { x: 15, z: 17 };
export const MAILROOM_PICKUP: Vec2 = { x: 5.5, z: 15 };
/** First spot is nearest the counter; the line runs away from it. */
export const APPROVALS_QUEUE: readonly Vec2[] = [
  { x: 10, z: 14.5 },
  { x: 10, z: 15.5 },
  { x: 10, z: 16.5 },
];
export const APPROVALS_COUNTER: Vec2 = { x: 10, z: 13.5 };

function meetingPieces(): Furniture[] {
  return MEETING_ROOMS.flatMap((room, index) => {
    const south = index === 1;
    return [
      piece('meeting-table', room.table.x, room.table.z, 0, room.tableWidth, room.tableDepth),
      piece('rug', room.table.x, room.table.z, 0, 4.5, 3, false, index),
      piece('whiteboard', 5, south ? 11.3 : 0.7, south ? Math.PI : 0, 1.5, 0.5),
      piece('plant', 6.25, south ? 11.25 : 0.75, 0, 0.5, 0.5, true, 1 + index),
      piece('floor-lamp', 0.75, south ? 11.25 : 0.75, 0, 0.4, 0.4),
    ];
  });
}

function workspacePieces(): Furniture[] {
  return [
    piece('plant', 7.75, 0.75, 0, 0.5, 0.5, true, 0),
    piece('plant', 7.75, 11.25, 0, 0.5, 0.5, true, 3),
    piece('plant', 29.25, 0.75, 0, 0.5, 0.5, true, 2),
    piece('plant', 27.25, 11.25, 0, 0.5, 0.5, true, 4),
    piece('plant', 14, 3, 0, 0.5, 0.5, true, 1),
    piece('plant', 20, 3, 0, 0.5, 0.5, true, 5),
    piece('plant', 14, 8.5, 0, 0.5, 0.5, true, 3),
    piece('plant', 20, 8.5, 0, 0.5, 0.5, true, 0),
    piece('rug', 29, 6, 0, 2, 5, false, 2),
    WORKSPACE_SOFA,
    piece('side-table', 29.5, 4.5, -HALF_PI, 0.5, 0.5),
    piece('floor-lamp', 29.5, 7.75, 0, 0.4, 0.4),
    piece('plant', 29.25, 3.25, 0, 0.5, 0.5, true, 4),
    piece('plant', 26.6, 0.75, 0, 0.5, 0.5, true, 1),
    ...coolerPieces(),
  ];
}

function mailroomPieces(): Furniture[] {
  const west = [13.5, 15, 16.5].map((z) => piece('shelf', 0.5, z, HALF_PI, 1.5, 0.5));
  const north = [2, 3.5, 5].map((x) => piece('shelf', x, 12.5, 0, 1.5, 0.5));
  return [
    ...west,
    ...north,
    piece('sorting-table', 3.5, 15.5, 0, 2.5, 1),
    piece('parcels', 4.1, 17.4, 0, 0.8, 0.8),
    piece('rug', 5.5, 15, 0, 1.5, 1.5, false, 3),
  ];
}

function approvalsPieces(): Furniture[] {
  return [
    // The mesh adds a ledge in front and a low work surface with legs behind the body.
    piece('reception', APPROVALS_COUNTER.x, APPROVALS_COUNTER.z, 0, 3.5, 0.8, true, 0, {
      x0: -1.81,
      z0: -0.65,
      x1: 1.81,
      z1: 0.46,
    }),
    piece('rug', 10, 15.5, 0, 3, 3, false, 4),
    ...[
      [9.35, 15],
      [10.65, 15],
      [9.35, 16.5],
      [10.65, 16.5],
    ].map(([x, z]) => piece('stanchion', x ?? 0, z ?? 0, 0, 0.3, 0.3)),
  ];
}

function lobbyPieces(): Furniture[] {
  return [
    piece('door-mat', 15, 17.6, 0, 2, 0.8, false),
    piece('rug', 15, 14.5, 0, 2, 3.5, false, 5),
    piece('cooler', 13.5, 12.75, 0, 0.45, 0.45),
    piece('plant', 16.5, 17.25, 0, 0.5, 0.5, true, 1),
    piece('plant', 13.5, 17.25, 0, 0.5, 0.5, true, 0),
    piece('plant', 16.5, 12.75, 0, 0.5, 0.5, true, 4),
  ];
}

export const FURNITURE: readonly Furniture[] = [
  ...deskPieces(),
  ...podPieces(),
  ...meetingPieces(),
  ...workspacePieces(),
  ...mailroomPieces(),
  ...approvalsPieces(),
  ...lobbyPieces(),
  ...kitchenPieces(),
  ...hallPieces(),
  ...dormPieces(),
  ...gamesPieces(),
];

/**
 * Every spot a walker may start or end inside: desk chairs, meeting seats, lunch chairs and sofa
 * cushions. These are walls to everyone else. The nav grid and the verification script read this list.
 */
export const SEAT_FOOTPRINTS: readonly SeatFootprint[] = [
  ...DESK_SLOTS.map((slot) => seatFootprint(slot.chair)),
  ...MEETING_ROOMS.flatMap((room) => room.seats.map((s) => seatFootprint(s.pos))),
  ...wingSeatFootprints(),
];

function kitchenSpots(): Vec2[] {
  const kitchen = { x0: 17.5, z0: 12.5, x1: 29.5, z1: 23.5 };
  const obstacles = [
    ...FURNITURE.filter((item) => item.blocks).map(footprintRect),
    ...SEAT_FOOTPRINTS.map((s) => s.rect),
    ...WALLS.map(wallRect),
  ];
  // Walking clearance (0.2) plus the largest jitter a bot adds to its spot (0.22).
  const clearance = 0.45;
  const spots: Vec2[] = [];
  for (let x = kitchen.x0; x <= kitchen.x1; x += 1) {
    for (let z = kitchen.z0; z <= kitchen.z1; z += 1) {
      const free = obstacles.every(
        (r) => x < r.x0 - clearance || x > r.x1 + clearance || z < r.z0 - clearance || z > r.z1 + clearance,
      );
      if (free) spots.push({ x, z });
    }
  }
  return spots;
}

export const KITCHEN_SPOTS: readonly Vec2[] = kitchenSpots();

export const WALL_DECOR: readonly WallDecor[] = [
  { kind: 'window', x: 11.5, z: 0, nx: 0, nz: 1, width: 2.2, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'window', x: 17.5, z: 0, nx: 0, nz: 1, width: 2.2, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'window', x: 23.5, z: 0, nx: 0, nz: 1, width: 2.2, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'art', x: 14.5, z: 0, nx: 0, nz: 1, width: 0.8, height: 1.0, y: 1.2, variant: 1 },
  { kind: 'art', x: 20.5, z: 0, nx: 0, nz: 1, width: 0.8, height: 1.0, y: 1.2, variant: 2 },
  { kind: 'window', x: 27.5, z: 0, nx: 0, nz: 1, width: 1.8, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'art', x: 30, z: 5.4, nx: -1, nz: 0, width: 0.7, height: 0.9, y: 1.4, variant: 3 },
  { kind: 'art', x: 30, z: 6.6, nx: -1, nz: 0, width: 0.7, height: 0.9, y: 1.4, variant: 4 },
  { kind: 'window', x: 30, z: 2.4, nx: -1, nz: 0, width: 1.6, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'art', x: 0, z: 3, nx: 1, nz: 0, width: 1.0, height: 0.8, y: 1.4, variant: 0 },
  { kind: 'art', x: 0, z: 9, nx: 1, nz: 0, width: 1.0, height: 0.8, y: 1.4, variant: 2 },
  { kind: 'art', x: 18.8, z: 24, nx: 0, nz: -1, width: 0.7, height: 0.9, y: 1.4, variant: 1 },
  { kind: 'art', x: 19.5, z: 24, nx: 0, nz: -1, width: 0.7, height: 0.9, y: 1.4, variant: 3 },
  { kind: 'window', x: 24.5, z: 24, nx: 0, nz: -1, width: 2.2, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'window', x: 21.2, z: 24, nx: 0, nz: -1, width: 1.6, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'window', x: 27.8, z: 24, nx: 0, nz: -1, width: 1.6, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'art', x: 10, z: 18, nx: 0, nz: -1, width: 1.2, height: 0.8, y: 1.5, variant: 2 },
  { kind: 'window', x: 3, z: 18, nx: 0, nz: -1, width: 1.8, height: 1.2, y: 1.0, variant: 0 },
  // Dormitory: high curtained windows over each bunk pair, a shuttered one on the east wall.
  ...[0, 1, 2, 3, 4].map((pair): WallDecor => ({
    kind: 'window', x: 35.65 + pair * 3, z: 0, nx: 0, nz: 1, width: 1.7, height: 0.6, y: 1.85, variant: 1,
  })),
  { kind: 'window', x: 50, z: 2.0, nx: -1, nz: 0, width: 1.6, height: 1.2, y: 1.25, variant: 2 },
  { kind: 'window', x: 50, z: 7.0, nx: -1, nz: 0, width: 1.6, height: 1.2, y: 1.25, variant: 1 },
  // Games room: posters low enough to stay under the cut-away stub, a window on the south wall.
  { kind: 'poster', x: 34, z: 11.4, nx: 1, nz: 0, width: 0.55, height: 0.75, y: 0.4, variant: 0 },
  { kind: 'poster', x: 34, z: 12.3, nx: 1, nz: 0, width: 0.55, height: 0.75, y: 0.4, variant: 1 },
  { kind: 'poster', x: 34, z: 13.2, nx: 1, nz: 0, width: 0.55, height: 0.75, y: 0.4, variant: 2 },
  { kind: 'poster', x: 38.2, z: 9, nx: 0, nz: 1, width: 0.55, height: 0.75, y: 0.4, variant: 3 },
  { kind: 'poster', x: 39.1, z: 9, nx: 0, nz: 1, width: 0.55, height: 0.75, y: 0.4, variant: 4 },
  { kind: 'poster', x: 40.0, z: 9, nx: 0, nz: 1, width: 0.55, height: 0.75, y: 0.4, variant: 1 },
  { kind: 'window', x: 40.0, z: 24, nx: 0, nz: -1, width: 2.2, height: 1.3, y: 0.95, variant: 0 },
  { kind: 'poster', x: 36.5, z: 24, nx: 0, nz: -1, width: 0.8, height: 1.1, y: 1.1, variant: 0 },
  { kind: 'poster', x: 48.0, z: 24, nx: 0, nz: -1, width: 0.8, height: 1.1, y: 1.1, variant: 2 },
  { kind: 'poster', x: 50, z: 17.5, nx: -1, nz: 0, width: 0.8, height: 1.1, y: 1.1, variant: 3 },
  { kind: 'poster', x: 50, z: 21.5, nx: -1, nz: 0, width: 0.8, height: 1.1, y: 1.1, variant: 4 },
  { kind: 'window', x: 50, z: 15.0, nx: -1, nz: 0, width: 2.0, height: 1.3, y: 0.95, variant: 0 },
];

/** Where the real point lights hang at night (eight in all: the rest of the glow is painted as light pools). */
export const LAMP_SPOTS: Readonly<Record<string, LampSpot>> = {
  west: { x: 3.5, y: 2.4, z: 9 },
  approvals: { x: 10, y: 2.3, z: 14.5 },
  kitchen: { x: 24.5, y: 2.4, z: 17.5 },
  workspaceWest: { x: 12, y: 2.6, z: 6 },
  workspaceEast: { x: 21, y: 2.6, z: 6 },
  hall: { x: 32, y: 2.4, z: 14 },
  dormitory: { x: 42, y: 2.4, z: 4.5 },
  games: { x: POOL.x, y: 2.1, z: POOL.z },
};
