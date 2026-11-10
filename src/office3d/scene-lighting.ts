import type { SettingsSource } from '../office-contracts';
import type { Phase } from './actors/schedule';
import type { PickTarget } from './actors/types';
import { type Daylight, daylightAt } from './daylight';
import { DESK_SLOTS, zoneAt } from './layout';
import type { ZoneId } from './layout.types';
import { LIGHT_GROUPS, type LightGroup, type LightLevels, lightLevels } from './lighting-model';
import type { World } from './world';

/** Lighting is recomputed this often at most; the scene only re-renders when something visibly changed. */
const UPDATE_INTERVAL_MS = 250;
/** Lamps and glows fade at this rate (per second) when the office changes: someone sits down, a phase ends. */
const FADE_RATE = 3;
const DESK_REACH = 0.75;

export interface SceneLightingOptions {
  readonly world: World;
  /** Office wall-clock time (see ScheduleClock). */
  readonly now: () => Date;
  readonly settings: SettingsSource;
  readonly phase: () => Phase;
  readonly bots: () => Iterable<PickTarget>;
  /** Preview only: `&date=MM-DD` moves the sun to another day of the year without touching the schedule. */
  readonly search?: string | null;
}

export interface LightingTick {
  /** Something visible changed. */
  readonly render: boolean;
  /** The sun moved far enough that the static shadow map is stale. */
  readonly shadow: boolean;
}

const IDLE: LightingTick = { render: false, shadow: false };

function seasonOverride(search: string | null | undefined): { month: number; day: number } | null {
  if (search === null || search === undefined) return null;
  const match = /^(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/.exec(new URLSearchParams(search).get('date') ?? '');
  return match === null ? null : { month: Number(match[1]) - 1, day: Number(match[2]) };
}

function approach(current: number, target: number, k: number): number {
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 0.004 ? target : next;
}

/**
 * Drives the scene's day and night: samples the sun from the office clock, turns the schedule phase and
 * who is where into lamp levels, eases them, and hands the result to the world, the page backdrop and
 * the characters. Cheap by design: a few evaluations a second, a render only when the picture changes.
 */
export class SceneLighting {
  private readonly season: { month: number; day: number } | null;
  private readonly groups = new Map<LightGroup, number>(LIGHT_GROUPS.map((group) => [group, 0]));
  private readonly deskLamp = DESK_SLOTS.map(() => 0);
  private readonly deskScreen = DESK_SLOTS.map(() => 0);
  private lastUpdate = Number.NEGATIVE_INFINITY;
  private lastSignature = '';
  private lastBackdrop = '';
  private dirty = true;
  private snap = true;
  private readonly unsubscribe: () => void;
  /** Latest values, for debugging and the preview hooks. */
  daylight: Daylight | null = null;
  levels: LightLevels | null = null;

  constructor(private readonly options: SceneLightingOptions) {
    this.season = seasonOverride(options.search);
    this.unsubscribe = options.settings.subscribe(() => {
      this.dirty = true;
      this.snap = true;
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** Call every frame with the frame time in ms; does real work only a few times a second. */
  tick(nowMs: number): LightingTick {
    if (!this.dirty && nowMs - this.lastUpdate < UPDATE_INTERVAL_MS) return IDLE;
    const elapsed = Number.isFinite(this.lastUpdate) ? (nowMs - this.lastUpdate) / 1000 : 0;
    this.lastUpdate = nowMs;
    this.dirty = false;
    return this.update(elapsed);
  }

  private update(elapsedSeconds: number): LightingTick {
    const { world, settings } = this.options;
    const mode = settings.get().lighting?.mode ?? 'clock';
    const daylight = daylightAt(this.dated(this.options.now()), mode);
    const occupied = new Set<ZoneId>();
    const seated = new Set<number>();
    for (const bot of this.options.bots()) {
      const zone = zoneAt(bot.x, bot.z);
      if (zone !== 'outside') occupied.add(zone);
      for (const slot of DESK_SLOTS) {
        if (Math.hypot(bot.x - slot.chair.x, bot.z - slot.chair.z) < DESK_REACH) seated.add(slot.id);
      }
    }
    const targets = lightLevels(daylight, {
      phase: this.options.phase(),
      occupied,
      tvOn: world.rigs.games.screen.currentMode !== 'off',
    });
    const k = this.snap ? 1 : 1 - Math.exp(-FADE_RATE * elapsedSeconds);
    this.snap = false;
    for (const group of LIGHT_GROUPS) {
      this.groups.set(group, approach(this.groups.get(group) ?? 0, targets.groups[group], k));
    }
    const dark = daylight.lampFactor;
    DESK_SLOTS.forEach((slot) => {
      const lamp = seated.has(slot.id) ? dark : 0;
      const state = world.screens.stateOf(slot.id);
      const screen = state === 'off' ? 0 : (state === 'on' ? 1 : 0.55) * (0.12 + 0.88 * dark);
      this.deskLamp[slot.id] = approach(this.deskLamp[slot.id] ?? 0, lamp, k);
      this.deskScreen[slot.id] = approach(this.deskScreen[slot.id] ?? 0, screen, k);
    });
    const levels: LightLevels = { ...targets, groups: Object.fromEntries(this.groups) as Record<LightGroup, number> };
    this.daylight = daylight;
    this.levels = levels;

    const signature = this.signatureOf(daylight, levels);
    this.applyBackdrop(levels);
    if (signature === this.lastSignature) return IDLE;
    this.lastSignature = signature;
    const shadow = world.applyLighting(levels, daylight);
    world.setDeskLights(this.deskLamp, this.deskScreen);
    return { render: true, shadow };
  }

  /** The date with `&date=` applied, keeping the time of day. */
  private dated(date: Date): Date {
    const season = this.season;
    if (season === null) return date;
    return new Date(date.getFullYear(), season.month, season.day, date.getHours(), date.getMinutes(), date.getSeconds());
  }

  private signatureOf(daylight: Daylight, levels: LightLevels): string {
    const q = (value: number, steps: number): number => Math.round(value * steps);
    const groups = LIGHT_GROUPS.map((group) => q(levels.groups[group], 60)).join(',');
    const desks = [...this.deskLamp, ...this.deskScreen].map((value) => q(value, 20)).join('');
    return [
      q(daylight.dayFactor, 100), q(daylight.golden, 50), q(daylight.elevation, 2), q(daylight.azimuth, 1),
      groups, desks,
    ].join('|');
  }

  /** Paints the page behind the canvas with the scene's current sky, so a noon office is not on a navy backdrop. */
  private applyBackdrop(levels: LightLevels): void {
    const { bg, glow, edge, dot } = levels.backdrop;
    const key = `${bg}${glow}${edge}${dot}`;
    if (key === this.lastBackdrop) return;
    this.lastBackdrop = key;
    const root = document.documentElement;
    root.style.setProperty('--scene-bg', bg);
    root.style.setProperty('--scene-glow', glow);
    root.style.setProperty('--scene-edge', edge);
    root.style.setProperty('--scene-dot', dot);
    root.dataset.scene = this.daylight !== null && this.daylight.dayFactor < 0.5 ? 'night' : 'day';
  }
}
