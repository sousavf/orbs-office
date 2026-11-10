import type { Scene } from 'three';
import type { FigureSource, IdlePlace, IslandSource, SettingsSource } from '../office-contracts';
import type { BotState, OfficeEvent, OfficeFeed, OfficeState } from '../feed/office.types';
import { prefersReducedMotion } from '../reduced-motion';
import { type ActorDebug, BotActor } from './actors/bot-actor';
import { Clock, type Timer } from './actors/clock';
import { Courier } from './actors/courier';
import { type DeskAssignment, assignDesks } from './actors/desk-plan';
import { GamesDirector } from './actors/games/games-director';
import { ApprovalsQueue, KitchenSpots, MeetingRooms, SeatPool, nearestTo } from './actors/occupancy';
import { type Phase, ScheduleClock, phaseAt } from './actors/schedule';
import { type ActorContext, type PickTarget, type Stand } from './actors/types';
import type { KitchenLife } from './actors/kitchen-life';
import { type AvatarSource, AvatarHeads } from './avatar-heads';
import { BlobShadows } from './blob-shadows';
import type { Character } from './character';
import { CharacterKit } from './character-kit';
import { BEDS, COOLER_SPOTS, DESK_SLOTS, ISLANDS, LOUNGE_SEATS, LUNCH_SEATS, MAILROOM_PICKUP } from './layout';
import type { Vec2 } from './layout.types';
import { NavGrid } from './nav-grid';
import type { OverlayLayer } from './overlay/overlay-layer';
import type { Sleeper, WorldRigs } from './rigs';
import type { DeskScreens } from './screens';

/** A walker yields to a bot closer than this, within about 70 degrees of its heading. */
const AHEAD_DISTANCE = 0.55;
const AHEAD_COSINE = 0.35;
const OVERLAP_DISTANCE = 0.15;
/** At most this share of the idle bots is on a break at once (at least one). */
const BREAK_SHARE = 0.3;
const PHASE_CHECK_SECONDS = 1;
const PLACES_SECONDS = 0.25;
const REMOVAL_GRACE_MS = 3000;
const DISCONNECTED_GRACE_MS = 15_000;

export interface CrowdOptions {
  readonly scene: Scene;
  readonly feed: OfficeFeed;
  readonly figures: FigureSource;
  readonly avatars: AvatarSource;
  readonly screens: DeskScreens;
  readonly overlays: OverlayLayer;
  /** Camera zoom relative to the framed office. */
  readonly zoomRatio: () => number;
  readonly requestRender: () => void;
  readonly rigs: WorldRigs;
  /** The owner's office settings: working hours and island names. */
  readonly settings: SettingsSource;
  /** Which island each bot is set to live on. */
  readonly islands: IslandSource;
  /** Local time for the schedule (real, or simulated in preview). */
  readonly schedule: ScheduleClock;
  /** Called when what idle bots are doing changed (at most a few times a second). */
  readonly onPlaces?: (places: ReadonlyMap<string, IdlePlace>) => void;
  /** Called with the connection state and bot count after every state event. */
  readonly onState?: (state: OfficeState) => void;
}

/**
 * Every character in the office. Owns the shared allocation (kitchen spots, approvals line,
 * meeting rooms, desk screens), the clock the actors' timers run on, and the feed subscription.
 * The per-bot behaviour lives in `BotActor`.
 */
export class Crowd implements ActorContext {
  readonly clock = new Clock();
  readonly nav = new NavGrid();
  readonly kit: CharacterKit;
  readonly overlays: OverlayLayer;
  private readonly blobs: BlobShadows;
  private readonly avatars: AvatarHeads;
  private readonly rooms = new MeetingRooms();
  private readonly queue = new ApprovalsQueue();
  private readonly kitchen = new KitchenSpots();
  private readonly lunch = new SeatPool(LUNCH_SEATS);
  private readonly lounge = new SeatPool(LOUNGE_SEATS);
  private readonly cooler = new SeatPool(COOLER_SPOTS);
  private readonly beds = new SeatPool(BEDS);
  readonly games: GamesDirector;
  private plan = new Map<string, DeskAssignment>();
  private readonly removals = new Map<string, Timer>();
  private currentPhase: Phase = 'work';
  private phaseClock = 0;
  private placesClock = 0;
  private placesSignature = '';
  private readonly unsubscribeSettings: () => void;
  private readonly unsubscribeIslands: () => void;
  private islandNames = '';
  private readonly actors = new Map<string, BotActor>();
  private readonly couriers = new Set<Courier>();
  private readonly bodies: Character[] = [];
  private readonly monitors = new Map<number, Set<string>>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeFigures: () => void;
  private reduced = prefersReducedMotion();
  private headingX = 0;
  private headingZ = 1;
  private blobsDirty = true;
  private daemonUrl = '';
  private hoverId: string | null = null;
  private pinnedId: string | null = null;

  constructor(private readonly options: CrowdOptions) {
    this.overlays = options.overlays;
    this.avatars = new AvatarHeads(options.avatars);
    this.kit = new CharacterKit();
    this.games = new GamesDirector(options.rigs.games);
    this.games.setReducedMotion(this.reduced);
    this.currentPhase = phaseAt(options.schedule.now(), options.settings.get());
    this.syncIslandNames();
    this.blobs = new BlobShadows();
    options.scene.add(this.blobs.mesh);
    options.screens.setAll('off');
    this.unsubscribeFigures = options.figures.subscribe(() => {
      for (const [id, actor] of this.actors) actor.setFigure(options.figures.get(id));
      options.requestRender();
    });
    this.unsubscribeSettings = options.settings.subscribe(() => this.onSettings());
    this.unsubscribeIslands = options.islands.subscribe(() => this.onSettings());
    this.unsubscribe = options.feed.subscribe((event) => this.handleEvent(event));
  }

  get count(): number {
    return this.actors.size;
  }

  /** Texture memory used by the sprite sheets, in bytes. */
  get textureBytes(): number {
    return this.kit.atlas.bytes;
  }

  /** The bots a pointer can hit. */
  get targets(): Iterable<PickTarget> {
    return this.actors.values();
  }

  actorFor(botId: string): BotActor | undefined {
    return this.actors.get(botId);
  }

  reducedMotion(): boolean {
    return this.reduced;
  }

  zoomRatio(): number {
    return this.options.zoomRatio();
  }

  setReducedMotion(reduced: boolean): void {
    if (reduced === this.reduced) return;
    this.reduced = reduced;
    this.games.setReducedMotion(reduced);
    for (const actor of this.actors.values()) actor.refreshMotionPreference();
    this.options.requestRender();
  }

  /** Camera heading (horizontal unit vector from the office toward the camera). */
  setView(headingX: number, headingZ: number): void {
    this.headingX = headingX;
    this.headingZ = headingZ;
  }

  /** The bot under the pointer keeps its name showing. */
  setHovered(botId: string | null): void {
    if (botId === this.hoverId) return;
    if (this.hoverId !== null) this.actors.get(this.hoverId)?.setHovered(false);
    this.hoverId = botId;
    if (botId !== null) this.actors.get(botId)?.setHovered(true);
  }

  /** The bot whose popup is open keeps its name showing. */
  setPinned(botId: string | null): void {
    if (botId === this.pinnedId) return;
    if (this.pinnedId !== null) this.actors.get(this.pinnedId)?.setPinned(false);
    this.pinnedId = botId;
    if (botId !== null) this.actors.get(botId)?.setPinned(true);
  }

  /** Advances timers, walking and animation; returns true when anything on screen changed. */
  update(deltaSeconds: number): boolean {
    this.clock.update(deltaSeconds * 1000);
    let changed = this.blobsDirty;
    let moved = false;
    this.phaseClock += deltaSeconds;
    if (this.phaseClock >= PHASE_CHECK_SECONDS) {
      this.phaseClock = 0;
      this.syncPhase();
    }
    if (this.games.update(deltaSeconds)) changed = true;
    for (const actor of this.actors.values()) moved = actor.update(deltaSeconds) || moved;
    for (const courier of this.couriers) {
      moved = courier.update(deltaSeconds) || moved;
      if (courier.done) this.couriers.delete(courier);
    }
    for (const body of this.bodies) {
      body.setView(this.headingX, this.headingZ);
      if (body.update(deltaSeconds)) changed = true;
    }
    this.placesClock += deltaSeconds;
    if (this.placesClock >= PLACES_SECONDS) {
      this.placesClock = 0;
      this.reportPlaces();
    }
    if (moved || this.blobsDirty) {
      this.writeBlobs();
      this.blobsDirty = false;
      changed = true;
    }
    return changed;
  }

  /** Where every bot is and what it plays; for debugging and screenshots. */
  describe(): ActorDebug[] {
    return [...this.actors.values()].map((actor) => actor.debug());
  }

  handleEvent(event: OfficeEvent): void {
    switch (event.kind) {
      case 'state':
        this.reconcile(event.state);
        break;
      case 'mail':
        this.deliverMail(event.botId);
        break;
      case 'reply':
        this.actors.get(event.botId)?.showReply(event.text);
        break;
      case 'failed':
        this.actors.get(event.botId)?.flashFailure();
        break;
    }
    this.options.requestRender();
  }

  dispose(): void {
    this.unsubscribe();
    this.unsubscribeFigures();
    this.unsubscribeSettings();
    this.unsubscribeIslands();
    for (const actor of [...this.actors.values()]) actor.destroy();
    this.actors.clear();
    for (const courier of this.couriers) courier.destroy();
    this.couriers.clear();
    this.options.scene.remove(this.blobs.mesh);
    this.blobs.dispose();
    this.avatars.dispose();
    this.kit.dispose();
  }

  // ActorContext

  addBody(character: Character): void {
    this.bodies.push(character);
    this.options.scene.add(character.mesh);
    this.blobs.setCount(this.bodies.length);
    this.blobsDirty = true;
  }

  removeBody(character: Character): void {
    const index = this.bodies.indexOf(character);
    if (index >= 0) this.bodies.splice(index, 1);
    this.options.scene.remove(character.mesh);
    this.blobs.setCount(this.bodies.length);
    this.blobsDirty = true;
  }

  claimMeetingSeat(botId: string, group: readonly string[]): Stand | null {
    return this.rooms.claim(botId, group);
  }

  releaseMeetingSeat(botId: string): void {
    this.rooms.release(botId);
  }

  claimQueueSpot(botId: string): Stand {
    return this.queue.claim(botId);
  }

  releaseQueueSpot(botId: string): void {
    this.queue.release(botId);
  }

  claimKitchenSpot(botId: string, near?: Vec2): Stand {
    return this.kitchen.claim(botId, near);
  }

  releaseKitchenSpot(botId: string): void {
    this.kitchen.release(botId);
  }

  kitchenNeighbour(botId: string, pos: Vec2, distance: number): KitchenLife | null {
    for (const [id, actor] of this.actors) {
      if (id === botId) continue;
      const other = actor.position;
      if (Math.hypot(other.x - pos.x, other.z - pos.z) > distance) continue;
      const chatter = actor.chatter;
      if (chatter !== null) return chatter;
    }
    return null;
  }

  botAhead(botId: string, pos: Vec2, target: Vec2): Vec2 | null {
    const length = Math.hypot(target.x - pos.x, target.z - pos.z);
    if (length < 1e-4) return null;
    const hx = (target.x - pos.x) / length;
    const hz = (target.z - pos.z) / length;
    let nearest: Vec2 | null = null;
    let nearestDistance = AHEAD_DISTANCE;
    for (const [id, actor] of this.actors) {
      if (id === botId) continue;
      const other = actor.position;
      const dx = other.x - pos.x;
      const dz = other.z - pos.z;
      const distance = Math.hypot(dx, dz);
      // Bots already on top of each other are let through; waiting would only deadlock them.
      if (distance < OVERLAP_DISTANCE || distance >= nearestDistance) continue;
      if ((dx * hx + dz * hz) / distance < AHEAD_COSINE) continue;
      nearest = other;
      nearestDistance = distance;
    }
    return nearest;
  }

  deskFor(botId: string): DeskAssignment {
    const assignment = this.plan.get(botId);
    if (assignment !== undefined) return assignment;
    const slot = DESK_SLOTS[0];
    if (slot === undefined) throw new Error('Layout has no desks');
    return { slot, wrap: 0 };
  }

  claimLunchSeat(botId: string, near: Vec2): Stand | null {
    const seat = this.lunch.claim(botId, nearestTo(near, (candidate) => candidate.position));
    return seat === null ? null : { pos: seat.position, face: seat.facing, lift: seat.lift, id: seat.id };
  }

  releaseLunchSeat(botId: string): void {
    this.lunch.release(botId);
  }

  claimBed(botId: string, bedId: string): Stand | null {
    const bed = this.beds.claimId(botId, bedId);
    return bed === null ? null : { pos: bed.approach, face: null, id: bed.id };
  }

  releaseBed(botId: string): void {
    this.beds.release(botId);
  }

  claimLounge(botId: string): Stand | null {
    const seat = this.lounge.claim(botId);
    return seat === null ? null : { pos: seat.pos, face: seat.facing, lift: seat.lift, id: seat.id };
  }

  releaseLounge(botId: string): void {
    this.lounge.release(botId);
  }

  claimCooler(botId: string): Stand | null {
    const spot = this.cooler.claim(botId);
    return spot === null ? null : { pos: spot.pos, face: spot.facing, id: spot.id };
  }

  releaseCooler(botId: string): void {
    this.cooler.release(botId);
  }

  setTray(seatId: string, visible: boolean): void {
    this.options.rigs.trays.setTray(seatId, visible);
    this.options.requestRender();
  }

  setSleeper(bedId: string, sleeper: Sleeper | null, fadeMs = 0): void {
    this.options.rigs.sleep.setSleeper(bedId, sleeper, fadeMs);
    this.options.requestRender();
  }

  bedHead(bedId: string): { x: number; y: number; z: number } | null {
    return this.options.rigs.sleep.headAnchor(bedId);
  }

  mayBreak(botId: string): boolean {
    let idle = 0;
    let onBreak = 0;
    for (const [id, actor] of this.actors) {
      if (!actor.isIdle) continue;
      idle += 1;
      if (actor.onBreak && id !== botId) onBreak += 1;
    }
    return onBreak < Math.max(1, Math.floor(idle * BREAK_SHARE));
  }

  timeScale(): number {
    return this.options.schedule.timeScale;
  }

  phase(): Phase {
    return this.currentPhase;
  }

  setMonitor(botId: string, deskId: number, on: boolean): void {
    let users = this.monitors.get(deskId);
    if (users === undefined) {
      users = new Set();
      this.monitors.set(deskId, users);
    }
    if (on) users.add(botId);
    else users.delete(botId);
    this.options.screens.set(deskId, users.size > 0 ? 'on' : 'off');
    this.options.requestRender();
  }

  private reconcile(state: OfficeState): void {
    this.daemonUrl = state.connection.kind === 'connected' ? state.connection.serverUrl : '';
    // A bot missing from one update (a reconnect, a refetch) keeps its place for a moment rather than vanishing and snapping back.
    const grace = state.connection.kind === 'connected' ? REMOVAL_GRACE_MS : DISCONNECTED_GRACE_MS;
    for (const [id, actor] of [...this.actors]) {
      if (state.bots.has(id)) {
        this.removals.get(id)?.cancel();
        this.removals.delete(id);
      } else if (!this.removals.has(id)) {
        this.removals.set(
          id,
          this.clock.after(grace, () => {
            this.removals.delete(id);
            this.removeActor(id, actor);
            this.blobsDirty = true;
            this.options.requestRender();
          }),
        );
      }
    }
    const bots = [...state.bots.values()].sort((a, b) => a.rank - b.rank);
    this.plan = assignDesks(bots, (id) => this.options.islands.get(id));
    for (const bot of bots) {
      const existing = this.actors.get(bot.id);
      const actor = existing ?? this.addActor(bot);
      if (existing !== undefined) actor.applyState(bot);
      this.syncAvatar(bot, actor);
    }
    this.blobsDirty = true;
    this.options.onState?.(state);
    this.options.requestRender();
  }

  /** Island choices, names or working hours changed. */
  private onSettings(): void {
    this.plan = assignDesks([...this.actors.values()].map((actor) => ({ id: actor.id, rank: actor.rank })), (id) => this.options.islands.get(id));
    for (const actor of this.actors.values()) actor.refreshAssignment();
    this.syncIslandNames();
    this.syncPhase();
    this.options.requestRender();
  }

  private syncIslandNames(): void {
    const names = this.options.settings.get().islandNames ?? {};
    const signature = JSON.stringify(names);
    if (signature === this.islandNames) return;
    this.islandNames = signature;
    for (const island of ISLANDS) this.options.rigs.islands.setIslandName(island.id, names[island.id] ?? island.defaultName);
  }

  private syncPhase(): void {
    const phase = phaseAt(this.options.schedule.now(), this.options.settings.get());
    if (phase === this.currentPhase) return;
    this.currentPhase = phase;
    for (const actor of this.actors.values()) actor.setPhase(phase);
  }

  private reportPlaces(): void {
    if (this.options.onPlaces === undefined) return;
    const places = new Map<string, IdlePlace>();
    let signature = '';
    for (const [id, actor] of this.actors) {
      const place = actor.idlePlace;
      if (place === null) continue;
      places.set(id, place);
      signature += `${id}:${place};`;
    }
    if (signature === this.placesSignature) return;
    this.placesSignature = signature;
    this.options.onPlaces(places);
  }

  private addActor(bot: BotState): BotActor {
    const actor = new BotActor(this, bot);
    actor.setFigure(this.options.figures.get(bot.id));
    this.actors.set(bot.id, actor);
    return actor;
  }

  private removeActor(id: string, actor: BotActor): void {
    if (this.hoverId === id) this.hoverId = null;
    if (this.pinnedId === id) this.pinnedId = null;
    this.avatars.remove(id);
    actor.destroy();
    this.plan.delete(id);
    this.actors.delete(id);
  }

  private syncAvatar(bot: BotState, actor: BotActor): void {
    this.avatars.sync(bot, this.daemonUrl, (botId) => {
      this.actors.get(botId)?.setHead(this.avatars.get(botId));
      this.options.requestRender();
    });
    actor.setHead(this.avatars.get(bot.id));
  }

  private deliverMail(botId: string): void {
    const actor = this.actors.get(botId);
    if (actor === undefined) return;
    const courier = new Courier(this, () => this.couriers.delete(courier));
    this.couriers.add(courier);
    const { pos, face } = actor.deliveryStand;
    courier.deliver(MAILROOM_PICKUP, pos, face);
  }

  private writeBlobs(): void {
    for (let index = 0; index < this.bodies.length; index += 1) {
      const body = this.bodies[index];
      if (body !== undefined) this.blobs.place(index, body.x, body.z, body.mesh.visible ? body.scale * (0.4 + 0.6 * body.opacity) : 0);
    }
  }
}
