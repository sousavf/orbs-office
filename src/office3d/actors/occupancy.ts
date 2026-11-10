import { APPROVALS_COUNTER, APPROVALS_QUEUE, KITCHEN_SPOTS, MEETING_ROOMS } from '../layout';
import type { MeetingRoom, Vec2 } from '../layout.types';
import type { Stand } from './types';

const WANDER_RADIUS = 3;
const SAME_SPOT = 0.01;
/** Largest nudge, per axis, that keeps bots sharing a kitchen spot from standing on each other. */
const JITTER = 0.22;

function sameSpot(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < SAME_SPOT && Math.abs(a.z - b.z) < SAME_SPOT;
}

function direction(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

function pick<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

/** Direction from a seat to the nearest point of the table top. */
function towardTable(room: MeetingRoom, seat: Vec2): Vec2 {
  const halfW = room.tableWidth / 2;
  const halfD = room.tableDepth / 2;
  const nearest = {
    x: Math.min(room.table.x + halfW, Math.max(room.table.x - halfW, seat.x)),
    z: Math.min(room.table.z + halfD, Math.max(room.table.z - halfD, seat.z)),
  };
  return direction(seat, nearest);
}

/** Seat order: the first two bots sit across the table from each other, then the rest fill in. */
const SEAT_ORDER: readonly number[] = [0, 2, 1, 3, 4, 5];

interface Held {
  readonly room: MeetingRoom;
  readonly seat: number;
}

/**
 * Meeting-room allocation, so bots in the same meeting share a room. A group joins the room one
 * of its members already holds; otherwise it takes an empty room. Null when no room has space.
 */
export class MeetingRooms {
  private readonly held = new Map<string, Held>();

  claim(botId: string, group: readonly string[]): Stand | null {
    const existing = this.held.get(botId);
    if (existing !== undefined) return this.stand(existing);
    const room = this.roomForGroup(group) ?? this.emptyRoom();
    if (room === undefined) return null;
    const taken = new Set([...this.held.values()].filter((entry) => entry.room === room).map((entry) => entry.seat));
    const seat = SEAT_ORDER.find((index) => index < room.seats.length && !taken.has(index));
    if (seat === undefined) return null;
    const entry = { room, seat };
    this.held.set(botId, entry);
    return this.stand(entry);
  }

  release(botId: string): void {
    this.held.delete(botId);
  }

  private stand({ room, seat }: Held): Stand | null {
    const place = room.seats[seat];
    return place === undefined ? null : { pos: place.pos, face: towardTable(room, place.pos) };
  }

  private roomForGroup(group: readonly string[]): MeetingRoom | undefined {
    for (const id of group) {
      const entry = this.held.get(id);
      if (entry !== undefined) return entry.room;
    }
    return undefined;
  }

  private emptyRoom(): MeetingRoom | undefined {
    const used = new Set([...this.held.values()].map((entry) => entry.room.id));
    return MEETING_ROOMS.find((room) => !used.has(room.id));
  }
}

/** Hands out the approvals-counter line, nearest spot first; when it is full the last spot is shared. */
export class ApprovalsQueue {
  private readonly held = new Map<string, number>();

  claim(botId: string): Stand {
    let index = this.held.get(botId);
    if (index === undefined) {
      const taken = new Set(this.held.values());
      index = APPROVALS_QUEUE.findIndex((_, candidate) => !taken.has(candidate));
      if (index < 0) index = APPROVALS_QUEUE.length - 1;
      this.held.set(botId, index);
    }
    const pos = APPROVALS_QUEUE[index] ?? APPROVALS_COUNTER;
    return { pos, face: direction(pos, APPROVALS_COUNTER) };
  }

  release(botId: string): void {
    this.held.delete(botId);
  }
}

/** Stable per-bot nudge, so bots that share a kitchen spot do not overlap exactly. */
function jitterFor(botId: string): Vec2 {
  let hash = 0;
  for (const char of botId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { x: (((hash % 13) - 6) / 6) * JITTER, z: ((((hash >> 4) % 13) - 6) / 6) * JITTER };
}

/**
 * Hands out kitchen spots so idle bots spread out. Claiming again moves the bot to another spot
 * within wandering distance. When every spot is taken one is shared (and nudged).
 */
export class KitchenSpots {
  private readonly held = new Map<string, Vec2>();

  claim(botId: string, near?: Vec2): Stand {
    const previous = this.held.get(botId);
    this.held.delete(botId);
    const taken = [...this.held.values()];
    const free = KITCHEN_SPOTS.filter((spot) => !taken.some((other) => sameSpot(other, spot)));
    const close =
      near === undefined ? free : free.filter((spot) => Math.hypot(spot.x - near.x, spot.z - near.z) <= WANDER_RADIUS);
    const moved = close.filter((spot) => previous === undefined || !sameSpot(spot, previous));
    const spot = pick(moved) ?? pick(close) ?? pick(free) ?? pick(KITCHEN_SPOTS) ?? previous;
    if (spot === undefined) throw new Error('Layout has no kitchen spots');
    this.held.set(botId, spot);
    const nudge = jitterFor(botId);
    return { pos: { x: spot.x + nudge.x, z: spot.z + nudge.z }, face: null };
  }

  release(botId: string): void {
    this.held.delete(botId);
  }
}

/** Anything with a stable id that one bot at a time may use: lunch seats, beds, sofa cushions, cooler spots. */
export interface Claimable {
  readonly id: string;
}

/**
 * Exclusive use of a fixed set of places. A bot holds at most one; claiming again returns what it
 * already holds, and `release` frees it. Nothing is shared: a full pool answers null.
 */
export class SeatPool<T extends Claimable> {
  private readonly held = new Map<string, T>();

  constructor(private readonly places: readonly T[]) {}

  /** Takes the free place that `choose` prefers; null when none is free. */
  claim(botId: string, choose: (free: readonly T[]) => T | undefined = pick): T | null {
    const existing = this.held.get(botId);
    if (existing !== undefined) return existing;
    const taken = new Set([...this.held.values()].map((place) => place.id));
    const place = choose(this.places.filter((candidate) => !taken.has(candidate.id)));
    if (place === undefined) return null;
    this.held.set(botId, place);
    return place;
  }

  /** Takes one named place if it is free (or already this bot's). */
  claimId(botId: string, id: string): T | null {
    const existing = this.held.get(botId);
    if (existing?.id === id) return existing;
    const holder = [...this.held.entries()].find(([, place]) => place.id === id);
    const place = this.places.find((candidate) => candidate.id === id);
    if (holder !== undefined || place === undefined) return null;
    this.held.set(botId, place);
    return place;
  }

  release(botId: string): void {
    this.held.delete(botId);
  }

  get used(): number {
    return this.held.size;
  }
}

/** The free place closest to `from`. */
export function nearestTo<T>(from: Vec2, position: (place: T) => Vec2): (free: readonly T[]) => T | undefined {
  return (free) => {
    let best: T | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const place of free) {
      const at = position(place);
      const distance = Math.hypot(at.x - from.x, at.z - from.z);
      if (distance < bestDistance) {
        best = place;
        bestDistance = distance;
      }
    }
    return best;
  };
}
