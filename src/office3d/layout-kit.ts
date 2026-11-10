import type { Furniture, FurnitureKind, Rect, Seat, Vec2 } from './layout.types';

export const HALF_PI = Math.PI / 2;

export function yawOf(facing: Vec2): number {
  return Math.atan2(facing.x, facing.z);
}

/** Axis-aligned footprint of a piece in the plan; rotations are multiples of 90 degrees. */
export function footprintRect(item: Furniture): Rect {
  const local = item.extent ?? {
    x0: -item.width / 2,
    z0: -item.depth / 2,
    x1: item.width / 2,
    z1: item.depth / 2,
  };
  const cos = Math.round(Math.cos(item.rotY));
  const sin = Math.round(Math.sin(item.rotY));
  // Same turn as Matrix4.makeRotationY, which places the mesh.
  const corners = [
    [local.x0, local.z0],
    [local.x1, local.z0],
    [local.x0, local.z1],
    [local.x1, local.z1],
  ].map(([x = 0, z = 0]) => ({ x: item.x + x * cos + z * sin, z: item.z - x * sin + z * cos }));
  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

/** Side of the square a desk chair, meeting seat or dining chair takes on the floor. */
export const CHAIR_SIZE = 0.6;

export function piece(
  kind: FurnitureKind,
  x: number,
  z: number,
  rotY: number,
  width: number,
  depth: number,
  blocks = true,
  variant = 0,
  extent?: Rect,
): Furniture {
  return { kind, x, z, rotY, width, depth, blocks, variant, extent };
}

export function seat(x: number, z: number, fx: number, fz: number): Seat {
  const facing = { x: fx, z: fz };
  return { pos: { x, z }, facing, facingYaw: yawOf(facing) };
}

export function unit(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** A footprint a seated or standing figure may start or end a walk inside, centred on a seat. */
export interface SeatFootprint {
  readonly pos: Vec2;
  readonly rect: Rect;
}

export function seatFootprint(pos: Vec2, width = CHAIR_SIZE, depth = CHAIR_SIZE): SeatFootprint {
  return { pos, rect: { x0: pos.x - width / 2, z0: pos.z - depth / 2, x1: pos.x + width / 2, z1: pos.z + depth / 2 } };
}
