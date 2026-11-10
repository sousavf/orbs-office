import { yawOf } from './layout-kit';
import type { DeskSlot, Furniture, Island, IslandId, Vec2 } from './layout.types';
import { piece } from './layout-kit';

// Workspace: 3 x 2 islands of six desks. Desks sit back to back with a 0.2 m divider gap.
export const POD_COLUMNS: readonly number[] = [9.5, 15.5, 21.5];
export const POD_ROWS: readonly number[] = [3, 8.5];
const DESK_PITCH = 1.5;
const DESKS_PER_SIDE = 3;
export const DESK_SIZE = { width: 1.5, depth: 0.8 } as const;
const ISLAND_IDS: readonly IslandId[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const SIGN_HEIGHT = 2.3;

type RawSlot = Omit<DeskSlot, 'id' | 'key'>;

function slotFor(desk: Vec2, deskRotY: number, chair: Vec2, islandId: DeskSlot['islandId'], scale = 1): RawSlot {
  const facing = { x: desk.x - chair.x, z: desk.z - chair.z };
  const length = Math.hypot(facing.x, facing.z);
  const unitFacing = { x: facing.x / length, z: facing.z / length };
  return { desk, deskRotY, chair, facing: unitFacing, facingYaw: yawOf(unitFacing), islandId, scale };
}

function islandSlots(): RawSlot[] {
  const raw: RawSlot[] = [];
  POD_ROWS.forEach((zc, row) => {
    for (const side of [-1, 1] as const) {
      POD_COLUMNS.forEach((colStart, col) => {
        const islandId = ISLAND_IDS[row * POD_COLUMNS.length + col] ?? 'A';
        for (let i = 0; i < DESKS_PER_SIDE; i++) {
          const x = colStart + i * DESK_PITCH;
          raw.push(slotFor({ x, z: zc + side * 0.5 }, side < 0 ? Math.PI : 0, { x, z: zc + side * 1.5 }, islandId));
        }
      });
    }
  });
  return raw.sort((a, b) => a.desk.z - b.desk.z || a.desk.x - b.desk.x);
}

/**
 * Standalone desks: two beside the mailroom door (against the approvals room's west wall, chairs
 * to the east), two along the approvals room's south wall near the entrance, the second one larger.
 */
function soloSlots(): RawSlot[] {
  return [
    slotFor({ x: 6.5, z: 13.6 }, -Math.PI / 2, { x: 5.55, z: 13.6 }, 'solo'),
    slotFor({ x: 6.5, z: 16.4 }, -Math.PI / 2, { x: 5.55, z: 16.4 }, 'solo'),
    slotFor({ x: 8.7, z: 17.45 }, Math.PI, { x: 8.7, z: 16.45 }, 'solo'),
    slotFor({ x: 12.0, z: 17.35 }, Math.PI, { x: 12.0, z: 16.2 }, 'solo', 1.2),
  ];
}

export const DESK_SLOTS: readonly DeskSlot[] = [...islandSlots(), ...soloSlots()].map((slot, id) => ({
  ...slot,
  id,
  key: slot.islandId === 'solo' ? `solo-${id - 36}` : `${slot.islandId}-${id}`,
}));

export const SOLO_DESKS: readonly DeskSlot[] = DESK_SLOTS.filter((slot) => slot.islandId === 'solo');

export const ISLANDS: readonly Island[] = ISLAND_IDS.map((id, index) => {
  const row = Math.floor(index / POD_COLUMNS.length);
  const col = index % POD_COLUMNS.length;
  const center = { x: (POD_COLUMNS[col] ?? 0) + DESK_PITCH, z: POD_ROWS[row] ?? 0 };
  return {
    id,
    defaultName: `Island ${id}`,
    center,
    sign: { x: center.x, y: SIGN_HEIGHT, z: center.z },
    deskIds: DESK_SLOTS.filter((slot) => slot.islandId === id).map((slot) => slot.id),
  };
});

export function deskSize(slot: DeskSlot): { width: number; depth: number } {
  return { width: DESK_SIZE.width * slot.scale, depth: DESK_SIZE.depth * slot.scale };
}

export function deskPieces(): Furniture[] {
  return DESK_SLOTS.map((slot) => {
    const { width, depth } = deskSize(slot);
    return piece('desk', slot.desk.x, slot.desk.z, slot.deskRotY, width, depth);
  });
}

export function podPieces(): Furniture[] {
  return POD_ROWS.flatMap((zc) => POD_COLUMNS.map((x0) => piece('divider', x0 + 1.5, zc, 0, 4.5, 0.04)));
}
