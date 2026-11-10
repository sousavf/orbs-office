import type { BotState, SubagentState } from '../../feed/office.types';
import { Character, type Figure } from '../character';
import { BEDS } from '../layout';
import { SLEEP_FADE_MS } from '../rigs/sleep-rig';
import type { Vec2 } from '../layout.types';
import type { IdlePlace } from '../../office-contracts';
import type { BotOverlay } from '../overlay/bot-overlay';
import type { Texture } from 'three';
import { dressSeed } from '../sprites/dress-colors';
import { ReplyLine, SpeechLine } from './chatter';
import { type Timer, cancelTimer } from './clock';
import { InternActor } from './intern-actor';
import type { DeskAssignment } from './desk-plan';
import { Fade } from './fade';
import { KitchenLife } from './kitchen-life';
import { type BreakSpot, Routine } from './routine';
import type { Phase } from './schedule';
import { parseColor, truncate } from './support';
import {
  AT_DESK,
  type ActorContext,
  type BubbleSpec,
  DWELL_MS,
  type PickTarget,
  type Place,
  type Stand,
  type Want,
  bubbleFor,
  isWorking,
  wantFor,
} from './types';
import { Walker } from './walker';

const WALK_SPEED = 1.6;
const WANDER_SPEED = 1.0;
const WANDER_TRIES = 4;
const CHAT_DISTANCE = 2;
const FAILURE_MS = 2000;
/** A walker held up by another bot waits this long, then plans around it, and after PATIENCE_MS walks on rather than deadlock. */
const REPLAN_MS = 450;
const PATIENCE_MS = 1500;
const IGNORE_MS = 1500;
/** Real tool spans are shorter than the feed's poll, so a tool bubble stays up at least this long. */
const TOOL_BUBBLE_MIN_MS = 2500;
/** Idle kitchen bots show their name only from this camera zoom up; interns from the lower one. */
const LABEL_ZOOM = 1.4;
const INTERN_LABEL_ZOOM = 1.15;
const NAME_MAX = 14;
/** Neighbouring desks hold consecutive ranks; alternate label heights keep long names apart. */
const LABEL_STAGGER_PX = 13;
/** Seated figures are raised to the chair seat; the sprite's hips sit low in its frame. */
const SEAT_LIFT = 0.2;
/** Soles to hair, in metres, and the gap the bubbles keep above it. */
const BODY_HEIGHT = 1.3;
const HEAD_ANCHOR = 1.46;
/** Bots past the last desk share one, nudged sideways by this much per lap. */
const WRAP_OFFSET = 0.45;
const CHATTY: ReadonlySet<Place['kind']> = new Set<Place['kind']>(['kitchen', 'lunch', 'pool', 'foosball', 'console']);
/** A bot at lunch alternates between eating and pausing for about these long. */
const EAT_MS: readonly [number, number] = [6000, 12000];
const PAUSE_MS: readonly [number, number] = [3000, 7000];
/** Height of the "Zzz" over a sleeping head. */
const ZZZ_LIFT = 0.3;
/** Interns stand behind the chair, side by side, in rows: [metres behind the chair, metres sideways]. */
const INTERN_SLOTS: readonly (readonly [number, number])[] = [
  [0.55, -1.0],
  [0.55, 1.0],
  [1.25, -0.5],
  [1.25, 0.5],
];

export interface ActorDebug {
  id: string;
  x: number;
  z: number;
  pose: string;
  walking: boolean;
  visible: boolean;
  asleep: boolean;
  state: string;
}

interface InternSlot {
  readonly actor: InternActor;
  readonly slot: number;
}

/**
 * One bot: where it is, what it is doing, and the bubbles that say so.
 *
 * Motion rule: a walk always finishes at its goal. State changes only redirect the bot once it has
 * arrived, after a short dwell at work places.
 */
export class BotActor implements PickTarget {
  readonly character: Character;
  private bot: BotState;
  private assignment: DeskAssignment;
  private place: Place = AT_DESK;
  private want: Want | null = 'desk';
  private arrived = true;
  private eating = true;
  private eatTimer: Timer | null = null;
  private headTexture: Texture | null = null;
  private readonly routine: Routine;
  private readonly bodyFade = new Fade(1);
  private figure: Figure = 'male';
  private monitorDesk: number | null = null;
  private readonly walker = new Walker();
  private dwellTimer: Timer | null = null;
  private failureTimer: Timer | null = null;
  private holdTimer: Timer | null = null;
  private heldTool: { readonly spec: BubbleSpec; readonly at: number } | null = null;
  private readonly life: KitchenLife;
  private readonly speech: SpeechLine;
  private readonly reply: ReplyLine;
  private readonly overlay: BotOverlay;
  private readonly interns = new Map<string, InternSlot>();
  private leaving: InternActor[] = [];
  private hovered = false;
  private pinned = false;
  private gone = false;
  private walkSpeed = WALK_SPEED;
  private waitMs = 0;
  private blockedMs = 0;
  private replanned = false;
  private ignoreMs = 0;

  constructor(
    private readonly ctx: ActorContext,
    bot: BotState,
  ) {
    this.bot = bot;
    this.assignment = ctx.deskFor(bot.id);
    this.character = new Character(ctx.kit);
    this.character.setReducedMotion(ctx.reducedMotion());
    ctx.addBody(this.character);
    this.overlay = ctx.overlays.create(bot.id);
    this.speech = new SpeechLine(ctx.clock, () => this.syncChat());
    this.reply = new ReplyLine(ctx.clock, () => this.syncChat());
    this.life = new KitchenLife(ctx.clock, {
      wander: () => this.wander(),
      speak: (line) => this.speak(line),
      neighbour: () => this.ctx.kitchenNeighbour(this.bot.id, this.here, CHAT_DISTANCE),
    });
    this.routine = new Routine(ctx.clock, () => ctx.timeScale(), {
      changed: () => {
        if (!this.gone) this.reconcile(false);
      },
      mayBreak: () => ctx.mayBreak(this.bot.id),
    });
    this.routine.setPhase(ctx.phase(), true);
    this.snapTo(this.deskStand());
    this.applyState(bot, true);
    this.overlay.setLabelShown(this.labelWanted());
  }

  // PickTarget
  get id(): string {
    return this.bot.id;
  }

  get x(): number {
    return this.character.x;
  }

  get y(): number {
    return this.character.mesh.position.y;
  }

  get z(): number {
    return this.character.z;
  }

  get height(): number {
    return BODY_HEIGHT;
  }

  /** World point just above the head, for the tooltip and popup. */
  get head(): { x: number; y: number; z: number } {
    return { x: this.character.x, y: this.character.mesh.position.y + BODY_HEIGHT + 0.1, z: this.character.z };
  }

  /** Viewport-space top of the label and bubble stack, so a tooltip can sit above it instead of on it. */
  get stackTop(): { x: number; y: number } | null {
    return this.overlay.topCentre();
  }

  get rank(): number {
    return this.bot.rank;
  }

  get botId(): string {
    return this.bot.id;
  }

  /** Non-null only while this bot is idle and settled in the kitchen, free to chat. */
  get chatter(): KitchenLife | null {
    return this.life.active ? this.life : null;
  }

  /** An idle bot with no break going and nothing to do sits at its desk. */
  get isIdle(): boolean {
    return this.bot.activity.kind === 'idle';
  }

  /** Dev hook for scripted footage; see `Routine.forceBreak`. */
  forceBreak(spot: BreakSpot | 'sleep' | null, minutes = 0): void {
    this.routine.forceBreak(spot, minutes);
  }

  get onBreak(): boolean {
    return this.routine.onBreak;
  }

  /** Where an idle bot is, or is heading, for the legend; null while it has real work. */
  get idlePlace(): IdlePlace | null {
    if (this.bot.activity.kind !== 'idle') return null;
    const asleep = this.place.kind === 'bed' || (this.place.kind === 'lounge' && this.want === 'sleep');
    if (asleep) return this.arrived ? 'sleeping' : 'bedtime';
    switch (this.place.kind) {
      case 'desk':
        return 'desk';
      case 'kitchen':
      case 'cooler':
        return 'break';
      case 'lounge':
        return 'lounge';
      case 'lunch':
        return 'lunch';
      case 'pool':
      case 'foosball':
      case 'console':
        return this.place.kind;
      default:
        return null;
    }
  }

  get position(): Vec2 {
    return this.here;
  }

  /** Where a courier should stand to hand over a letter: just behind the desk chair. */
  get deliveryStand(): { pos: Vec2; face: Vec2 } {
    const { pos, face } = this.deskStand();
    return { pos: { x: pos.x - (face?.x ?? 0) * 0.65, z: pos.z - (face?.z ?? 0) * 0.65 }, face: face ?? { x: 0, z: 1 } };
  }

  /** Where the bot is and what it plays; for debugging and screenshots. */
  debug(): ActorDebug {
    return {
      id: this.bot.id,
      x: this.character.x,
      z: this.character.z,
      pose: this.character.currentPose,
      walking: this.walker.active,
      visible: this.character.mesh.visible,
      asleep: this.asleep,
      state: `${this.place.kind}${this.dwellTimer === null ? '' : '+dwell'}`,
    };
  }

  applyState(bot: BotState, instant = false): void {
    this.bot = bot;
    this.syncIdentity();
    this.syncAssignment(instant);
    this.routine.setIdle(bot.activity.kind === 'idle');
    this.reconcile(instant);
    this.syncInterns();
  }

  setHead(texture: Texture | null): void {
    this.headTexture = texture;
    this.character.setHead(texture);
    if (this.place.kind === 'bed' && this.arrived) this.sleepInBed();
  }

  /** The day moved on (work, lunch, wind-down, off). */
  setPhase(phase: Phase): void {
    this.routine.setPhase(phase);
  }

  /** The desk assignment may have changed (new island choice, roster change). */
  refreshAssignment(): void {
    this.syncAssignment(false);
    this.reconcile(false);
  }

  setFigure(figure: Figure): void {
    this.figure = figure;
    this.character.setFigure(figure, dressSeed(this.bot.id));
    for (const [id, entry] of this.interns) {
      const sub = this.bot.subagents.find((candidate) => candidate.id === id);
      if (sub !== undefined) entry.actor.setIdentity(sub.name, parseColor(this.bot.color), figure);
    }
  }

  setHovered(on: boolean): void {
    this.hovered = on;
  }

  /** The bot whose popup is open keeps its name visible. */
  setPinned(on: boolean): void {
    this.pinned = on;
  }

  /** Shows the bot's chat reply over its head, wherever it is. */
  showReply(text: string): void {
    this.speech.clear();
    this.reply.show(text);
    this.overlay.setReply(text, !this.ctx.reducedMotion(), this.bot.name);
  }

  flashFailure(): void {
    this.failureTimer = cancelTimer(this.failureTimer);
    this.speech.setSuppressed(true);
    this.showBubble({ key: 'alert' });
    this.failureTimer = this.ctx.clock.after(FAILURE_MS, () => {
      this.failureTimer = null;
      this.present();
    });
  }

  /** The reduced-motion preference changed: stop wandering and walking, or start again. */
  refreshMotionPreference(): void {
    const reduced = this.ctx.reducedMotion();
    this.character.setReducedMotion(reduced);
    for (const { actor } of this.interns.values()) actor.character.setReducedMotion(reduced);
    if (reduced) {
      this.speech.clear();
      this.walker.stop();
      this.dwellTimer = cancelTimer(this.dwellTimer);
      this.snapTo(this.destination());
      this.reconcile(true);
    } else {
      this.present();
    }
  }

  /** Advances walking, labels and interns; returns true when something the camera sees changed. */
  update(deltaSeconds: number): boolean {
    let changed = false;
    if (this.walker.active) {
      changed = true;
      if (!this.yielding(deltaSeconds) && this.walker.advance(this.character, deltaSeconds)) this.onArrive(true);
    }
    this.followGame();
    if (this.bodyFade.update(deltaSeconds * 1000)) {
      this.character.setOpacity(this.bodyFade.value);
      changed = true;
    }
    for (const { actor } of this.interns.values()) changed = actor.update(deltaSeconds) || changed;
    if (this.leaving.length > 0) {
      for (const actor of this.leaving) changed = actor.update(deltaSeconds) || changed;
      this.leaving = this.leaving.filter((actor) => !actor.done);
    }
    this.overlay.setLabelShown(this.labelWanted());
    const internNames = this.hovered || this.pinned || this.ctx.zoomRatio() >= INTERN_LABEL_ZOOM;
    for (const { actor } of this.interns.values()) actor.setLabelShown(internNames);
    this.anchorOverlay();
    return changed;
  }

  destroy(): void {
    this.gone = true;
    this.failureTimer = cancelTimer(this.failureTimer);
    this.holdTimer = cancelTimer(this.holdTimer);
    this.dwellTimer = cancelTimer(this.dwellTimer);
    this.eatTimer = cancelTimer(this.eatTimer);
    this.routine.stop();
    this.life.stop();
    this.speech.dispose();
    this.reply.dispose();
    this.walker.stop();
    this.releasePlace(this.place);
    this.setMonitor(null);
    for (const { actor } of this.interns.values()) actor.destroy();
    this.interns.clear();
    for (const actor of this.leaving) actor.destroy();
    this.leaving = [];
    this.ctx.removeBody(this.character);
    this.character.dispose();
    this.ctx.overlays.remove(this.overlay);
  }

  private get here(): Vec2 {
    return { x: this.character.x, z: this.character.z };
  }

  private get seated(): boolean {
    if (!this.arrived) return false;
    const { kind } = this.place;
    return kind === 'desk' || kind === 'meeting' || kind === 'lunch' || kind === 'lounge' || kind === 'console';
  }

  private get asleep(): boolean {
    return this.arrived && (this.place.kind === 'bed' || (this.place.kind === 'lounge' && this.want === 'sleep'));
  }

  /** Idle bots off at breaks, lunch or bed crowd the same rooms, so their names show only on demand. */
  private labelWanted(): boolean {
    if (this.bot.activity.kind !== 'idle' || this.place.kind === 'desk') return true;
    return (
      this.hovered ||
      this.pinned ||
      this.speech.active ||
      this.reply.active ||
      this.ctx.zoomRatio() >= LABEL_ZOOM
    );
  }

  private syncIdentity(): void {
    this.overlay.setName(truncate(this.bot.name, NAME_MAX));
    this.overlay.setLift((this.bot.rank % 2) * LABEL_STAGGER_PX);
    this.character.setTint(parseColor(this.bot.color));
  }

  private syncAssignment(instant: boolean): void {
    const next = this.ctx.deskFor(this.bot.id);
    if (next.slot.id === this.assignment.slot.id && next.wrap === this.assignment.wrap) return;
    this.setMonitor(null);
    this.assignment = next;
    // A bed belongs to a desk: forget where the bot meant to be so it is looked up again.
    if (this.want === 'sleep') this.want = null;
    if (this.place.kind === 'desk' && this.travel(instant, WALK_SPEED) === 'blocked') this.stay();
    this.repositionInterns();
  }

  private wanted(): Want {
    return wantFor(this.bot.activity, this.routine.intent);
  }

  private reconcile(instant: boolean): void {
    const want = this.wanted();
    if (want === this.want) {
      this.dwellTimer = cancelTimer(this.dwellTimer);
      this.present();
      return;
    }
    if (!instant && (!this.arrived || this.dwellTimer !== null)) {
      this.present();
      return;
    }
    this.depart(want, instant);
  }

  private depart(want: Want, instant: boolean): void {
    this.leavePlace();
    const next = this.claimPlace(want);
    // A meeting with no free room keeps the bot at its desk and asks again on the next update.
    if (!(want === 'meeting' && next.kind === 'desk')) this.want = want;
    if (next.kind === this.place.kind && (next.kind === 'desk' || next.kind === 'kitchen')) {
      this.place = next;
      this.present();
      return;
    }
    this.go(next, instant);
  }

  private go(next: Place, instant: boolean): void {
    this.place = next;
    if (this.travel(instant, WALK_SPEED) === 'blocked') this.stay();
  }

  /** Claims the shared slot for `want`; a place that is full or has no free slot falls back to the kitchen (a meeting to the desk). */
  private claimPlace(want: Want): Place {
    const { ctx, bot } = this;
    const kitchen = (): Place => ({ kind: 'kitchen', stand: ctx.claimKitchenSpot(bot.id) });
    switch (want) {
      case 'kitchen':
        return kitchen();
      case 'queue':
        return { kind: 'queue', stand: ctx.claimQueueSpot(bot.id) };
      case 'meeting': {
        const group = bot.activity.kind === 'meeting' ? bot.activity.withBotIds : [];
        const stand = ctx.claimMeetingSeat(bot.id, [bot.id, ...group]);
        return stand === null ? AT_DESK : { kind: 'meeting', stand };
      }
      case 'desk':
        return AT_DESK;
      case 'cooler': {
        const stand = ctx.claimCooler(bot.id);
        return stand === null ? kitchen() : { kind: 'cooler', stand };
      }
      case 'lounge': {
        const stand = ctx.claimLounge(bot.id);
        return stand === null ? kitchen() : { kind: 'lounge', stand };
      }
      case 'lunch': {
        const stand = ctx.claimLunchSeat(bot.id, this.here);
        return stand === null ? kitchen() : { kind: 'lunch', stand };
      }
      case 'sleep': {
        const bed = this.assignment.wrap === 0 ? BEDS[this.assignment.slot.id] : undefined;
        const bunk = bed === undefined ? null : ctx.claimBed(bot.id, bed.id);
        if (bunk !== null) return { kind: 'bed', stand: bunk };
        const sofa = ctx.claimLounge(bot.id);
        return sofa === null ? kitchen() : { kind: 'lounge', stand: sofa };
      }
      case 'games': {
        const slot = ctx.games.claim(bot.id);
        return slot === null ? kitchen() : { kind: slot.kind, stand: slot.stand };
      }
    }
  }

  private releasePlace(place: Place): void {
    const { ctx } = this;
    const id = this.bot.id;
    switch (place.kind) {
      case 'kitchen':
        ctx.releaseKitchenSpot(id);
        break;
      case 'queue':
        ctx.releaseQueueSpot(id);
        break;
      case 'meeting':
        ctx.releaseMeetingSeat(id);
        break;
      case 'lunch':
        if (place.stand.id !== undefined) ctx.setTray(place.stand.id, false);
        ctx.releaseLunchSeat(id);
        break;
      case 'bed':
        // Waking: the sleeper leaves the bed and the figure is back at the bedside.
        if (place.stand.id !== undefined) ctx.setSleeper(place.stand.id, null, ctx.reducedMotion() ? 0 : SLEEP_FADE_MS);
        this.character.setVisible(true);
        this.fadeBody(1);
        this.overlay.setSleeping(false);
        ctx.releaseBed(id);
        break;
      case 'lounge':
        this.overlay.setSleeping(false);
        ctx.releaseLounge(id);
        break;
      case 'cooler':
        ctx.releaseCooler(id);
        break;
      case 'pool':
      case 'foosball':
      case 'console':
        ctx.games.release(id);
        break;
      case 'desk':
        break;
    }
  }

  private leavePlace(): void {
    this.life.stop();
    this.eatTimer = cancelTimer(this.eatTimer);
    this.speech.clear();
    this.releasePlace(this.place);
  }

  private wander(): void {
    if (this.place.kind !== 'kitchen' || !this.arrived) return;
    this.life.stop();
    for (let attempt = 0; attempt < WANDER_TRIES; attempt++) {
      this.place = { kind: 'kitchen', stand: this.ctx.claimKitchenSpot(this.bot.id, this.here) };
      if (this.travel(false, WANDER_SPEED) !== 'blocked') return;
    }
    this.stay();
  }

  private speak(line: string): void {
    if (this.reply.active) return;
    if (this.arrived && CHATTY.has(this.place.kind) && !this.ctx.reducedMotion()) this.speech.say(line);
  }

  private onArrive(allowDwell: boolean): void {
    this.arrived = true;
    this.settle();
    const dwellMs = DWELL_MS[this.place.kind];
    const stale = this.want !== this.wanted();
    if (stale && allowDwell && dwellMs > 0 && !this.ctx.reducedMotion()) {
      this.dwellTimer = this.ctx.clock.after(dwellMs, () => {
        this.dwellTimer = null;
        this.reconcile(false);
      });
      this.present();
      return;
    }
    this.reconcile(false);
  }

  /** The bot has reached its place: the tray appears, the bed takes its sleeper, the game starts. */
  private settle(): void {
    const { place, ctx } = this;
    switch (place.kind) {
      case 'lunch':
        if (place.stand.id !== undefined) ctx.setTray(place.stand.id, true);
        this.eating = true;
        this.scheduleEating();
        break;
      case 'bed':
        this.sleepInBed();
        break;
      case 'pool':
      case 'foosball':
      case 'console':
        ctx.games.arrive(this.bot.id);
        break;
      default:
        break;
    }
  }

  private sleepInBed(): void {
    const { place } = this;
    if (place.kind !== 'bed' || place.stand.id === undefined) return;
    this.ctx.setSleeper(place.stand.id, { color: parseColor(this.bot.color), headTexture: this.headTexture }, this.ctx.reducedMotion() ? 0 : SLEEP_FADE_MS);
    this.fadeBody(0);
  }

  /** Fades the figure in or out while a bed takes (or gives back) the sleeper; instant with reduced motion. */
  private fadeBody(target: 0 | 1): void {
    if (this.ctx.reducedMotion()) {
      this.character.setOpacity(target);
      this.character.setVisible(target === 1);
      return;
    }
    this.bodyFade.ease(target, SLEEP_FADE_MS, () => this.character.setVisible(target === 1));
  }

  private scheduleEating(): void {
    this.eatTimer = cancelTimer(this.eatTimer);
    if (this.ctx.reducedMotion()) return;
    const [min, max] = this.eating ? EAT_MS : PAUSE_MS;
    this.eatTimer = this.ctx.clock.after(min + Math.random() * (max - min), () => {
      this.eatTimer = null;
      this.eating = !this.eating;
      this.syncPose();
      this.scheduleEating();
    });
  }

  /** While playing, the director says which pose to hold, what to say and when the game is over. */
  private followGame(): void {
    const { kind } = this.place;
    if (!this.arrived || (kind !== 'pool' && kind !== 'foosball' && kind !== 'console')) return;
    const { games } = this.ctx;
    const id = this.bot.id;
    const pose = games.pose(id);
    if (pose !== this.character.currentPose) this.character.setPose(pose);
    const line = games.takeLine(id);
    if (line !== null) this.speak(line);
    if (games.takeVerdict(id) !== null) this.redirectBreak();
  }

  /** The game is over (no partner turned up, or the partner left): try the console, else the kitchen. */
  private redirectBreak(): void {
    this.leavePlace();
    const slot = this.ctx.games.claim(this.bot.id, false);
    this.go(slot === null ? { kind: 'kitchen', stand: this.ctx.claimKitchenSpot(this.bot.id) } : { kind: slot.kind, stand: slot.stand }, false);
  }

  private destination(): Stand {
    return this.place.kind === 'desk' ? this.deskStand() : this.place.stand;
  }

  /** The chair, nudged sideways for a bot that shares its desk with an earlier one. */
  private deskStand(): Stand {
    const { slot, wrap } = this.assignment;
    const side = { x: -slot.facing.z, z: slot.facing.x };
    return {
      pos: { x: slot.chair.x + side.x * WRAP_OFFSET * wrap, z: slot.chair.z + side.z * WRAP_OFFSET * wrap },
      face: slot.facing,
    };
  }

  /** Walks to the destination; 'blocked' means no route exists and the bot has not moved. */
  private travel(instant: boolean, speed: number): 'walking' | 'arrived' | 'blocked' {
    this.walker.stop();
    this.dwellTimer = cancelTimer(this.dwellTimer);
    this.resetYield();
    const goal = this.destination();
    if (instant || this.ctx.reducedMotion()) {
      this.snapTo(goal);
      this.onArrive(false);
      return 'arrived';
    }
    const path = this.ctx.nav.findPath(this.here, goal.pos);
    if (path === null) return 'blocked';
    this.arrived = false;
    this.setMonitor(null);
    this.character.setLift(0);
    this.character.setSeated(false);
    this.walkSpeed = speed;
    this.character.setPose('walk', speed);
    this.walker.start(path, speed);
    this.anchorOverlay();
    return 'walking';
  }

  /** No route to where the state wants the bot: it stays put rather than cut through furniture. */
  private stay(): void {
    const { kind } = this.place;
    if (kind !== 'desk' && kind !== 'kitchen' && kind !== 'queue' && kind !== 'meeting') {
      this.releasePlace(this.place);
      this.place = { kind: 'kitchen', stand: { pos: this.here, face: null } };
    }
    this.arrived = true;
    this.onArrive(false);
  }

  private resetYield(): void {
    this.waitMs = 0;
    this.blockedMs = 0;
    this.replanned = false;
    this.ignoreMs = 0;
  }

  /**
   * Holds a walker back while another bot stands in its way: wait, then plan around that bot, and
   * after a while walk on rather than deadlock. Returns true while the walker should not move.
   */
  private yielding(deltaSeconds: number): boolean {
    const ms = deltaSeconds * 1000;
    if (this.ignoreMs > 0) {
      this.ignoreMs -= ms;
      return false;
    }
    const target = this.walker.target;
    const blocker = target === null ? null : this.ctx.botAhead(this.bot.id, this.here, target);
    if (blocker === null) {
      if (this.waitMs > 0) this.resumeWalk();
      this.replanned = false;
      return false;
    }
    if (this.waitMs === 0) this.character.setPose('idle');
    this.waitMs += ms;
    this.blockedMs += ms;
    if (this.blockedMs >= PATIENCE_MS) {
      this.ignoreMs = IGNORE_MS;
      this.blockedMs = 0;
      this.resumeWalk();
      return false;
    }
    if (this.waitMs >= REPLAN_MS && !this.replanned) {
      this.replanned = true;
      const path = this.ctx.nav.findPath(this.here, this.destination().pos, [blocker]);
      if (path !== null) {
        this.walker.start(path, this.walkSpeed);
        this.resumeWalk();
        return false;
      }
    }
    return true;
  }

  private resumeWalk(): void {
    this.waitMs = 0;
    this.character.setPose('walk', this.walkSpeed);
  }

  private snapTo(stand: Stand): void {
    this.character.setPosition(stand.pos.x, stand.pos.z);
    this.arrived = true;
    this.repositionInterns();
  }

  private present(): void {
    const working = this.arrived && this.place.kind === 'desk' && (isWorking(this.bot.activity) || this.dwellTimer !== null);
    this.setMonitor(working ? this.assignment.slot.id : null);
    this.syncPose();
    const spec = this.resolveBubble();
    this.speech.setSuppressed(spec !== null || this.failureTimer !== null);
    const talks = this.arrived && spec === null && !this.ctx.reducedMotion();
    if (talks && this.place.kind === 'kitchen') this.life.start('kitchen');
    else if (talks && this.place.kind === 'lunch') this.life.start('lunch');
    else this.life.stop();
    this.overlay.setSleeping(this.asleep);
    if (this.failureTimer !== null) return;
    this.showBubble(spec);
  }

  /** One desk screen per bot at a time: on for the desk this bot works at, off for anything else. */
  private setMonitor(deskId: number | null): void {
    if (this.monitorDesk === deskId) return;
    if (this.monitorDesk !== null) this.ctx.setMonitor(this.bot.id, this.monitorDesk, false);
    this.monitorDesk = deskId;
    if (deskId !== null) this.ctx.setMonitor(this.bot.id, deskId, true);
  }

  /**
   * The bubble to show: the live one, except that a tool bubble outlasts its span for
   * TOOL_BUBBLE_MIN_MS. A newer tool, a waiting "?" or a meeting replaces it at once.
   */
  private resolveBubble(): BubbleSpec | null {
    const live = bubbleFor(this.bot.activity);
    const now = this.ctx.clock.now;
    if (this.bot.activity.kind === 'tool' && live !== null) {
      if (this.heldTool?.spec.key !== live.key) this.heldTool = { spec: live, at: now };
      return live;
    }
    const held = this.heldTool;
    const thinkingOrIdle = this.bot.activity.kind === 'thinking' || this.bot.activity.kind === 'idle';
    const remaining = held === null ? 0 : held.at + TOOL_BUBBLE_MIN_MS - now;
    this.holdTimer = cancelTimer(this.holdTimer);
    if (held === null || !thinkingOrIdle || remaining <= 0) {
      this.heldTool = null;
      return live;
    }
    this.holdTimer = this.ctx.clock.after(remaining, () => {
      this.holdTimer = null;
      this.present();
    });
    return held.spec;
  }

  /**
   * Picks the animation and the facing from where the bot is and what it is doing; walking is set
   * per step. Facing is a world direction (chair to desk, seat to table), which the character turns
   * into front or back view against the camera heading every frame.
   */
  private syncPose(): void {
    if (this.gone || !this.arrived) return;
    const stand = this.destination();
    const { kind } = this.place;
    this.character.setLift(kind === 'desk' || kind === 'meeting' ? SEAT_LIFT : (stand.lift ?? 0));
    this.character.setSeated(this.seated);
    if (stand.face === null) this.character.faceCamera();
    else this.character.setFacing(stand.face.x, stand.face.z);
    switch (kind) {
      case 'desk':
        this.character.setPose(isWorking(this.bot.activity) ? 'type' : 'sit');
        break;
      case 'meeting':
        this.character.setPose('sit');
        break;
      case 'queue':
        this.character.setPose('wait');
        break;
      case 'kitchen':
        this.character.setPose(this.speech.active || this.reply.active ? 'talk' : 'idle');
        break;
      case 'cooler':
        this.character.setPose('idle');
        break;
      case 'lunch':
        this.character.setPose(this.eating ? 'eat' : 'sit');
        break;
      case 'lounge':
        this.character.setPose('lounge');
        break;
      case 'pool':
      case 'foosball':
      case 'console':
        this.character.setPose(this.ctx.games.pose(this.bot.id));
        break;
      case 'bed':
        break;
    }
  }

  private showBubble(spec: BubbleSpec | null): void {
    this.overlay.setBadge(spec, !this.ctx.reducedMotion());
  }

  private syncChat(): void {
    if (this.gone) return;
    this.overlay.setSpeech(this.speech.text);
    this.overlay.setReply(this.reply.text, false, this.bot.name);
    this.syncPose();
  }

  private anchorOverlay(): void {
    const { place } = this;
    const pillow = place.kind === 'bed' && this.arrived && place.stand.id !== undefined ? this.ctx.bedHead(place.stand.id) : null;
    if (pillow !== null) {
      this.overlay.anchorX = pillow.x;
      this.overlay.anchorY = pillow.y + ZZZ_LIFT;
      this.overlay.anchorZ = pillow.z;
      return;
    }
    const head = this.character.mesh.position;
    this.overlay.anchorX = head.x;
    this.overlay.anchorY = head.y + HEAD_ANCHOR;
    this.overlay.anchorZ = head.z;
  }

  private syncInterns(): void {
    const present = new Set(this.bot.subagents.map((sub) => sub.id));
    for (const [id, entry] of this.interns) {
      if (present.has(id)) continue;
      entry.actor.leave();
      this.leaving.push(entry.actor);
      this.interns.delete(id);
    }
    this.bot.subagents.forEach((sub) => this.syncIntern(sub));
  }

  private syncIntern(sub: SubagentState): void {
    let entry = this.interns.get(sub.id);
    if (entry === undefined) {
      const actor = new InternActor(this.ctx, this.bot.id, sub.id);
      entry = { actor, slot: this.freeInternSlot() };
      this.interns.set(sub.id, entry);
      this.placeIntern(entry);
      actor.appear();
    }
    entry.actor.setIdentity(sub.name, parseColor(this.bot.color), this.figure).setActivity(sub.activity);
  }

  private freeInternSlot(): number {
    const used = new Set([...this.interns.values()].map((entry) => entry.slot));
    let slot = 0;
    while (used.has(slot)) slot += 1;
    return slot;
  }

  private placeIntern(entry: InternSlot): void {
    const [behind, sideways] = INTERN_SLOTS[entry.slot % INTERN_SLOTS.length] ?? [0.85, 0];
    const { pos, face } = this.deskStand();
    const f = face ?? { x: 0, z: 1 };
    entry.actor.placeAt(
      { x: pos.x - f.x * behind - f.z * sideways, z: pos.z - f.z * behind + f.x * sideways },
      f,
    );
  }

  private repositionInterns(): void {
    for (const entry of this.interns.values()) this.placeIntern(entry);
  }
}
