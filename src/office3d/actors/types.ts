import type { BotActivity, ToolFamily } from '../../feed/office.types';
import type { Character } from '../character';
import type { CharacterKit } from '../character-kit';
import type { Vec2 } from '../layout.types';
import type { NavGrid } from '../nav-grid';
import type { OverlayLayer } from '../overlay/overlay-layer';
import type { Clock } from './clock';
import type { Sleeper } from '../rigs';
import type { GamesDirector } from './games/games-director';
import type { KitchenLife } from './kitchen-life';
import type { DeskAssignment } from './desk-plan';
import type { Phase } from './schedule';

export type PlaceKind =
  | 'desk'
  | 'kitchen'
  | 'queue'
  | 'meeting'
  | 'lunch'
  | 'bed'
  | 'lounge'
  | 'cooler'
  | 'pool'
  | 'foosball'
  | 'console';

/** Where a bot wants to be; `games` resolves to a pool table, table football or the console when it sets out. */
export type Want = 'desk' | 'kitchen' | 'queue' | 'meeting' | 'lunch' | 'sleep' | 'lounge' | 'cooler' | 'games';

/** A spot in the office and the way a bot stands or sits there. `face` is a world direction, or null to look at the camera. */
export interface Stand {
  readonly pos: Vec2;
  readonly face: Vec2 | null;
  /** How far a seated figure is raised off the floor. */
  readonly lift?: number;
  /** The seat or bed this stand belongs to, where the rigs need to know. */
  readonly id?: string;
}

export type Place =
  | { readonly kind: 'desk' }
  | { readonly kind: Exclude<PlaceKind, 'desk'>; readonly stand: Stand };

export const AT_DESK: Place = { kind: 'desk' };

/** How long a bot lingers on arrival at a place its state has already moved on from. */
export const DWELL_MS: Readonly<Record<PlaceKind, number>> = {
  desk: 1200,
  queue: 800,
  meeting: 800,
  kitchen: 0,
  lunch: 0,
  bed: 0,
  lounge: 0,
  cooler: 0,
  pool: 0,
  foosball: 0,
  console: 0,
};

/** Real activity decides where a bot is; with none, `idle` (the routine's answer) does. */
export function wantFor(activity: BotActivity, idle: Want): Want {
  switch (activity.kind) {
    case 'idle':
      return idle;
    case 'thinking':
    case 'tool':
      return 'desk';
    case 'waiting':
      return 'queue';
    case 'meeting':
      return 'meeting';
  }
}

export function isWorking(activity: BotActivity): boolean {
  return activity.kind === 'thinking' || activity.kind === 'tool';
}

export type BubbleKey = ToolFamily | 'thought' | 'question' | 'alert';

export interface BubbleSpec {
  readonly key: BubbleKey;
  readonly count?: number;
}

export function bubbleFor(activity: BotActivity): BubbleSpec | null {
  switch (activity.kind) {
    case 'idle':
      return null;
    case 'thinking':
      return { key: 'thought' };
    case 'tool':
      return { key: activity.family };
    case 'waiting':
      return { key: 'question', count: activity.approvalCount > 0 ? activity.approvalCount : undefined };
    case 'meeting':
      return { key: 'message' };
  }
}

/** Anything a camera ray can hit: where its feet are and how tall it stands. */
export interface PickTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Metres from soles to hair. */
  readonly height: number;
}

/** What the office offers each actor: shared allocation, the clock, desk screens and the overlay layer. */
export interface ActorContext {
  readonly clock: Clock;
  readonly nav: NavGrid;
  readonly kit: CharacterKit;
  readonly overlays: OverlayLayer;
  reducedMotion(): boolean;
  /** Camera zoom relative to the framed office (1 = whole office). */
  zoomRatio(): number;
  addBody(character: Character): void;
  removeBody(character: Character): void;
  claimMeetingSeat(botId: string, group: readonly string[]): Stand | null;
  releaseMeetingSeat(botId: string): void;
  claimQueueSpot(botId: string): Stand;
  releaseQueueSpot(botId: string): void;
  claimKitchenSpot(botId: string, near?: Vec2): Stand;
  releaseKitchenSpot(botId: string): void;
  /** Another bot that is idle and settled in the kitchen within `distance` metres of `pos`. */
  kitchenNeighbour(botId: string, pos: Vec2, distance: number): KitchenLife | null;
  setMonitor(botId: string, deskId: number, on: boolean): void;
  /** The desk this bot is assigned to. */
  deskFor(botId: string): DeskAssignment;
  readonly games: GamesDirector;
  claimLunchSeat(botId: string, near: Vec2): Stand | null;
  releaseLunchSeat(botId: string): void;
  claimBed(botId: string, bedId: string): Stand | null;
  releaseBed(botId: string): void;
  claimLounge(botId: string): Stand | null;
  releaseLounge(botId: string): void;
  claimCooler(botId: string): Stand | null;
  releaseCooler(botId: string): void;
  setTray(seatId: string, visible: boolean): void;
  setSleeper(bedId: string, sleeper: Sleeper | null, fadeMs?: number): void;
  /** World point above the pillow, where a sleeping bot's labels hang. */
  bedHead(bedId: string): { x: number; y: number; z: number } | null;
  /** Whether one more idle bot may start a break (only a share of them are on one at a time). */
  mayBreak(botId: string): boolean;
  /** Dev knob: schedule seconds per real second. */
  timeScale(): number;
  phase(): Phase;
  /** Position of another bot standing or walking just ahead of `pos` on the way to `target`, or null. */
  botAhead(botId: string, pos: Vec2, target: Vec2): Vec2 | null;
}
