import { GAMES } from '../../layout';
import type { GameSpot } from '../../layout.types';
import type { PoseName } from '../../sprites/sprite.types';
import type { GamesRig } from '../../rigs/games-rig';
import type { Stand } from '../types';
import { FoosballSim } from './foosball-sim';
import { PoolSim } from './pool-sim';

export type GameKind = 'pool' | 'foosball' | 'console';

export interface GameSlot {
  readonly kind: GameKind;
  readonly stand: Stand;
}

export type GameVerdict = 'wait-expired' | 'partner-left';

/** A player alone at a table waits this long for a partner before giving up. */
const WAIT_SECONDS = 20;
/** A partner whose opponent left plays on for a few seconds before moving on. */
const FINISH_SECONDS: readonly [number, number] = [3, 6];
const CHAT_SECONDS: readonly [number, number] = [7, 14];
const CONSOLE_CHANCE = 0.35;

const POOL_LINES: readonly string[] = ['nice shot!', 'so close', 'your turn', 'good one', 'unlucky!', 'watch this'];
const FOOS_LINES: readonly string[] = ['goal!', 'so close', 'nice save', 'again?', 'too fast!', 'here we go'];
const CONSOLE_LINES: readonly string[] = ['my turn next', 'gg', 'one more round?', 'no way', 'nice combo', 'ha, got you'];

interface Seat {
  holder: string | null;
  arrivedAt: number | null;
}

interface Table {
  readonly kind: 'pool' | 'foosball';
  readonly seats: readonly [Seat, Seat];
  readonly spots: readonly [GameSpot, GameSpot];
  sim: PoolSim | FoosballSim | null;
  nextChat: number;
}

function between([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function pick<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

function emptySeat(): Seat {
  return { holder: null, arrivedAt: null };
}

function standOf(spot: GameSpot): Stand {
  return { pos: spot.pos, face: spot.facing };
}

/**
 * Who plays what in the games room. Pool and table football need exactly two players: a bot on a break
 * joins a waiting partner or waits a short while for one. The console takes one or two. Runs the
 * pool and foosball simulations while a table has both players seated, the TV while the console is in
 * use, and hands out the poses and the odd line of banter.
 */
export class GamesDirector {
  private readonly tables: readonly Table[];
  private readonly consoleSeats: readonly Seat[] = GAMES.console.seats.map(emptySeat);
  private readonly lines = new Map<string, string>();
  private readonly verdicts = new Map<string, GameVerdict>();
  private readonly leaveAt = new Map<string, number>();
  private time = 0;
  private reduced = false;
  private screenOn = false;
  private screenDirty = false;

  constructor(private readonly rig: GamesRig) {
    this.tables = [
      { kind: 'pool', seats: [emptySeat(), emptySeat()], spots: GAMES.pool.spots, sim: null, nextChat: 0 },
      { kind: 'foosball', seats: [emptySeat(), emptySeat()], spots: GAMES.foosball.spots, sim: null, nextChat: 0 },
    ];
    this.rig.screen.setMode('off');
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }

  /** Where `botId` could play now: a waiting partner's table, a free table, or a console seat; null when the room is full. */
  claim(botId: string, tablesAllowed = true): GameSlot | null {
    const held = this.slotOf(botId);
    if (held !== null) return held;
    if (tablesAllowed) {
      const waiting = this.tables.filter((t) => this.count(t) === 1);
      const waiter = pick(waiting);
      if (waiter !== undefined) return this.sit(waiter, botId);
      const empty = this.tables.filter((t) => this.count(t) === 0);
      const consoleFree = this.consoleSeats.some((s) => s.holder === null);
      const table = pick(empty);
      if (table !== undefined && (!consoleFree || Math.random() >= CONSOLE_CHANCE)) return this.sit(table, botId);
    }
    const index = this.consoleSeats.findIndex((s) => s.holder === null);
    const seat = this.consoleSeats[index];
    const spec = GAMES.console.seats[index];
    if (seat === undefined || spec === undefined) return null;
    seat.holder = botId;
    seat.arrivedAt = null;
    return { kind: 'console', stand: { pos: spec.pos, face: spec.facing, lift: spec.lift, id: spec.id } };
  }

  /** The bot has reached its place. */
  arrive(botId: string): void {
    for (const table of this.tables) {
      table.seats.forEach((seat) => {
        if (seat.holder === botId) seat.arrivedAt = this.time;
      });
      if (table.seats.every((s) => s.arrivedAt !== null) && table.sim === null) this.startGame(table);
    }
    for (const seat of this.consoleSeats) if (seat.holder === botId) seat.arrivedAt = this.time;
    this.syncScreen();
  }

  /** The bot leaves (or never arrives). Its partner finishes up and is told to move on. */
  release(botId: string): void {
    this.lines.delete(botId);
    this.verdicts.delete(botId);
    this.leaveAt.delete(botId);
    for (const table of this.tables) {
      const mine = table.seats.find((s) => s.holder === botId);
      if (mine === undefined) continue;
      const wasPlaying = table.sim !== null;
      mine.holder = null;
      mine.arrivedAt = null;
      table.sim = null;
      const other = table.seats.find((s) => s.holder !== null);
      if (wasPlaying && other?.holder != null) {
        other.arrivedAt = other.arrivedAt === null ? null : this.time;
        this.leaveAt.set(other.holder, this.time + between(FINISH_SECONDS));
        this.verdicts.delete(other.holder);
      }
    }
    for (const seat of this.consoleSeats) {
      if (seat.holder !== botId) continue;
      seat.holder = null;
      seat.arrivedAt = null;
    }
    this.syncScreen();
  }

  /** The pose for a bot that has arrived at its slot. */
  pose(botId: string): PoseName {
    for (const table of this.tables) {
      const index = table.seats.findIndex((s) => s.holder === botId);
      if (index < 0) continue;
      const playing = table.sim !== null;
      if (table.kind === 'foosball') return playing ? 'play-foosball' : 'idle';
      return playing && table.sim instanceof PoolSim && table.sim.turn === index && table.sim.phase !== 'rest'
        ? 'play-pool-shoot'
        : 'play-pool-wait';
    }
    return 'play-console';
  }

  takeLine(botId: string): string | null {
    const line = this.lines.get(botId) ?? null;
    this.lines.delete(botId);
    return line;
  }

  takeVerdict(botId: string): GameVerdict | null {
    const verdict = this.verdicts.get(botId) ?? null;
    this.verdicts.delete(botId);
    return verdict;
  }

  /** Advances games, waiting and chatter; returns true when a ball, rod or the TV moved. */
  update(deltaSeconds: number): boolean {
    this.time += deltaSeconds;
    let changed = false;
    for (const table of this.tables) {
      const [a, b] = table.seats;
      if (table.sim !== null && !this.reduced) {
        table.sim.update(deltaSeconds);
        changed = true;
      }
      if (table.sim !== null && this.time >= table.nextChat) {
        table.nextChat = this.time + between(CHAT_SECONDS);
        const speaker = pick([a.holder, b.holder].filter((id): id is string => id !== null));
        if (speaker !== undefined) this.say(speaker, pick(table.kind === 'pool' ? POOL_LINES : FOOS_LINES));
      }
      for (const seat of [a, b]) {
        const waiter = seat.holder;
        if (waiter === null || table.sim !== null || seat.arrivedAt === null) continue;
        if (this.time - seat.arrivedAt > WAIT_SECONDS) {
          this.verdicts.set(waiter, 'wait-expired');
          seat.arrivedAt = null;
        }
      }
    }
    if (this.screenOn && Math.random() < deltaSeconds / between(CHAT_SECONDS)) {
      const player = pick(this.consoleSeats.map((s) => s.holder).filter((id): id is string => id !== null));
      if (player !== undefined) this.say(player, pick(CONSOLE_LINES));
    }
    for (const [botId, when] of this.leaveAt) {
      if (this.time < when) continue;
      this.leaveAt.delete(botId);
      this.verdicts.set(botId, 'partner-left');
    }
    const dirty = this.screenDirty;
    this.screenDirty = false;
    return changed || dirty;
  }

  private count(table: Table): number {
    return table.seats.filter((s) => s.holder !== null).length;
  }

  private sit(table: Table, botId: string): GameSlot | null {
    const index = table.seats.findIndex((s) => s.holder === null);
    const seat = table.seats[index];
    const spot = table.spots[index];
    if (seat === undefined || spot === undefined) return null;
    seat.holder = botId;
    seat.arrivedAt = null;
    return { kind: table.kind, stand: standOf(spot) };
  }

  private slotOf(botId: string): GameSlot | null {
    for (const table of this.tables) {
      const index = table.seats.findIndex((s) => s.holder === botId);
      const spot = table.spots[index];
      if (spot !== undefined) return { kind: table.kind, stand: standOf(spot) };
    }
    return null;
  }

  private startGame(table: Table): void {
    table.nextChat = this.time + between(CHAT_SECONDS);
    if (table.kind === 'pool') {
      table.sim = new PoolSim(this.rig.pool, (event, shooter) => {
        const shooterId = table.seats[shooter]?.holder ?? null;
        const otherId = table.seats[1 - shooter]?.holder ?? null;
        if (event === 'pot' && shooterId !== null) this.say(shooterId, 'nice shot!');
        else if (event === 'miss' && Math.random() < 0.4 && shooterId !== null) this.say(shooterId, 'so close');
        else if (event === 'rerack' && otherId !== null) this.say(otherId, 'rematch?');
      });
    } else {
      table.sim = new FoosballSim(this.rig.foosball, (event) => {
        const speaker = pick(table.seats.map((s) => s.holder).filter((id): id is string => id !== null));
        if (speaker !== undefined) this.say(speaker, event === 'goal' ? 'goal!' : 'so close');
      });
    }
  }

  private say(botId: string, line: string | undefined): void {
    if (line !== undefined) this.lines.set(botId, line);
  }

  private syncScreen(): void {
    const on = this.consoleSeats.some((s) => s.arrivedAt !== null);
    if (on === this.screenOn) return;
    this.screenOn = on;
    this.screenDirty = true;
    this.rig.screen.setMode(on ? 'game' : 'off');
  }
}
