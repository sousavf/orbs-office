import type { ZoneId, ZoneOrOutside } from './layout.types';

export interface ZoneStyle {
  /** Floor base colour. */
  readonly top: number;
  /** Pattern colour (plank seams, terrazzo flecks, checker tone). */
  readonly mark: number;
  /** Painted wall colour facing this zone. */
  readonly wall: number;
}

/** Carried over from the 2D scene's palette (src/scenes/texture-factory.ts). */
const ZONES: Readonly<Record<ZoneId, ZoneStyle>> = {
  workspace: { top: 0xecca9c, mark: 0xd1a874, wall: 0xf6e7cf },
  corridor: { top: 0xefe4d3, mark: 0xcdb99f, wall: 0xf3e9db },
  'meeting-a': { top: 0x7fbab5, mark: 0x5a9a96, wall: 0xc4e3df },
  'meeting-b': { top: 0xb797b5, mark: 0x93708f, wall: 0xe0cbdd },
  mailroom: { top: 0xdfba82, mark: 0xbf9559, wall: 0xf3dcae },
  approvals: { top: 0xb4d4ac, mark: 0x8db685, wall: 0xd5e8cf },
  kitchen: { top: 0xe5a283, mark: 0xf3d6bc, wall: 0xf7d5bd },
  hall: { top: 0xeadfce, mark: 0xc9b79c, wall: 0xf1e6d6 },
  dormitory: { top: 0xd6cbe4, mark: 0xbeb0d2, wall: 0xe9e0f2 },
  games: { top: 0x8fb0cc, mark: 0x6f93b2, wall: 0xcfe0ee },
};

export function zoneStyle(zone: ZoneId): ZoneStyle {
  return ZONES[zone];
}

const OUTSIDE_WALL = 0xe6d6bd;

export function wallColor(zone: ZoneOrOutside): number {
  return zone === 'outside' ? OUTSIDE_WALL : ZONES[zone].wall;
}

export const WALL_CAP = 0xfffaf0;
export const SLAB = 0x9c8466;

export const CHAIR_COLORS: readonly number[] = [0xe0705a, 0x4f9aa6, 0xe3b34f, 0x8e78b8];
export const MUG_COLORS: readonly number[] = [0xf2f0ea, 0xe0705a, 0x4f9aa6, 0xe3b34f, 0x6fa57a];

export function shade(color: number, factor: number): number {
  const channel = (shift: number): number =>
    Math.min(255, Math.max(0, Math.round(((color >> shift) & 0xff) * factor)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Shadow darkness under props before the daylight model takes over. */
export const CONTACT_OPACITY = 0.42;
/** Tone-mapping exposure before the daylight model takes over. */
export const SCENE_EXPOSURE = 1.0;

export const LAMP_COLOR = 0xffc27a;
