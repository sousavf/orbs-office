/** Metres on the ground plane: x runs east, z runs south (top-down plan, y is up). */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** Metres, y up. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

export type ZoneId =
  | 'workspace'
  | 'meeting-a'
  | 'meeting-b'
  | 'mailroom'
  | 'approvals'
  | 'corridor'
  | 'kitchen'
  | 'hall'
  | 'dormitory'
  | 'games';

export type ZoneOrOutside = ZoneId | 'outside';

export interface Room {
  readonly id: ZoneId;
  readonly rect: Rect;
}

export type WallKind = 'solid' | 'glass';

/** Axis-aligned wall piece. `axis` is the direction it runs along; `fixed` is its centre line on the other axis. */
export interface WallSegment {
  readonly id: number;
  readonly axis: 'x' | 'z';
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
  readonly kind: WallKind;
  /** The segment ends a wall run here (corner or free end), so its box extends by half a thickness. */
  readonly capFrom: boolean;
  readonly capTo: boolean;
  /** Zone on the side with the smaller coordinate on the perpendicular axis (north or west). */
  readonly sideNeg: ZoneOrOutside;
  /** Zone on the side with the larger coordinate (south or east). */
  readonly sidePos: ZoneOrOutside;
}

export interface Door {
  readonly axis: 'x' | 'z';
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
}

export type FurnitureKind =
  | 'desk'
  | 'divider'
  | 'meeting-table'
  | 'whiteboard'
  | 'counter'
  | 'sink-counter'
  | 'fridge'
  | 'coffee-machine'
  | 'round-table'
  | 'stool'
  | 'sofa'
  | 'coffee-table'
  | 'shelf'
  | 'sorting-table'
  | 'parcels'
  | 'reception'
  | 'plant'
  | 'cooler'
  | 'rug'
  | 'floor-lamp'
  | 'stanchion'
  | 'door-mat'
  | 'side-table'
  | 'bunk-bed'
  | 'nightstand'
  | 'dresser'
  | 'lunch-table'
  | 'pool-table'
  | 'foosball-table'
  | 'tv-stand'
  | 'cue-rack'
  | 'game-shelf';

/** A placed piece. `size` is the local [width, depth] before rotation; the front faces local +z. */
export interface Furniture {
  readonly kind: FurnitureKind;
  readonly x: number;
  readonly z: number;
  readonly rotY: number;
  readonly width: number;
  readonly depth: number;
  /** Footprint blocks walking. Seats, rugs and decor do not. */
  readonly blocks: boolean;
  /** Picks a plant type, rug colour or similar. */
  readonly variant: number;
  /** Footprint relative to the piece centre before rotation, when the mesh is not centred on `size`. */
  readonly extent?: Rect;
}

export type IslandId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type DeskGroup = IslandId | 'solo';

export interface DeskSlot {
  /** Stable index; island desks keep their original 0..35 numbers, solo desks follow. */
  readonly id: number;
  readonly key: string;
  readonly islandId: DeskGroup;
  /** Size relative to a standard desk (the larger solo desk is 1.2). */
  readonly scale: number;
  readonly desk: Vec2;
  readonly deskRotY: number;
  readonly chair: Vec2;
  /** Unit vector from the chair toward the desk. */
  readonly facing: Vec2;
  /** Yaw (about +y) that turns local +z onto `facing`. */
  readonly facingYaw: number;
}

export interface Seat {
  readonly pos: Vec2;
  readonly facing: Vec2;
  readonly facingYaw: number;
}

/** A seat that sits on the floor plan as a footprint: a stool, sofa cushion, dining chair. */
export interface SeatSpot extends Seat {
  readonly id: string;
  /** How far the figure is raised off the floor to sit on it. */
  readonly lift: number;
}

export interface Island {
  readonly id: IslandId;
  readonly defaultName: string;
  readonly center: Vec2;
  /** Where the hanging sign's centre is. */
  readonly sign: Vec3;
  readonly deskIds: readonly number[];
}

export interface Bed {
  readonly id: string;
  readonly bunk: number;
  readonly level: 'lower' | 'upper';
  /** Centre of the mattress top. */
  readonly position: Vec3;
  /** Direction from head to foot of the bed, as a yaw. */
  readonly yaw: number;
  /** Walkable point beside the bed where a bot steps up. */
  readonly approach: Vec2;
  /** Where the sleeper's head rests (an anchor for a "Zzz" overlay sits a little above it). */
  readonly head: Vec3;
}

export interface LunchSeat {
  readonly id: string;
  readonly tableId: string;
  readonly position: Vec2;
  /** Yaw that turns local +z toward the table. */
  readonly yaw: number;
  readonly facing: Vec2;
  readonly lift: number;
}

export interface GameSpot {
  readonly pos: Vec2;
  readonly facing: Vec2;
  readonly facingYaw: number;
}

export interface GameTable {
  readonly center: Vec2;
  readonly width: number;
  readonly depth: number;
  /** Height of the playing surface. */
  readonly surfaceY: number;
}

export interface GamesLayout {
  readonly pool: { readonly table: GameTable; readonly spots: readonly [GameSpot, GameSpot] };
  readonly foosball: { readonly table: GameTable; readonly spots: readonly [GameSpot, GameSpot] };
  readonly console: {
    readonly screen: Vec3;
    readonly screenYaw: number;
    readonly seats: readonly [SeatSpot, SeatSpot];
  };
}

export interface MeetingRoom {
  readonly id: 'meeting-a' | 'meeting-b';
  readonly table: Vec2;
  readonly tableWidth: number;
  readonly tableDepth: number;
  readonly seats: readonly Seat[];
  readonly door: Vec2;
}

export type DecorKind = 'art' | 'window' | 'poster';

/** Wall-mounted piece. (nx, nz) is the unit normal pointing into the room. */
export interface WallDecor {
  readonly kind: DecorKind;
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly width: number;
  readonly height: number;
  readonly y: number;
  readonly variant: number;
}

export interface LampSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
