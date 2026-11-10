// Pure mapping from the daylight, the office's schedule phase and who is where to every number the scene
// lighting needs. Nothing here touches three.js, so the stages are easy to tune and reason about.

import type { Phase } from './actors/schedule';
import { type Daylight, mixColor, smoothstep } from './daylight';
import type { ZoneId } from './layout.types';

/** Lamp and light-pool groups that switch on and off together. */
export type LightGroup = ZoneId | 'dormNight' | 'poolTable' | 'tv';

export const LIGHT_GROUPS: readonly LightGroup[] = [
  'workspace', 'corridor', 'meeting-a', 'meeting-b', 'mailroom', 'approvals', 'kitchen', 'hall',
  'dormitory', 'games', 'dormNight', 'poolTable', 'tv',
];

export interface LightingContext {
  readonly phase: Phase;
  /** Rooms with at least one bot in them. */
  readonly occupied: ReadonlySet<ZoneId>;
  /** The console TV shows a menu or a game. */
  readonly tvOn: boolean;
}

export interface Backdrop {
  readonly bg: string;
  readonly glow: string;
  readonly edge: string;
  readonly dot: string;
}

export interface LightLevels {
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemiIntensity: number;
  readonly sunColor: number;
  readonly sunIntensity: number;
  /** Camera-side fill, so faces turned toward the viewer never go black when the sun is behind the building. */
  readonly fillIntensity: number;
  readonly exposure: number;
  /** Linear colour multiplied onto the character sprites. */
  readonly character: readonly [number, number, number];
  readonly contactOpacity: number;
  /** 0..1 per lamp group. */
  readonly groups: Readonly<Record<LightGroup, number>>;
  readonly backdrop: Backdrop;
}

const SECURITY_LEVEL = 0.28;

const DAY_HEMI_SKY = 0xfff3dc;
const DAY_HEMI_GROUND = 0xd8c3a2;
const GOLD_HEMI_SKY = 0xffd7aa;
const GOLD_HEMI_GROUND = 0xc9a98a;
const NIGHT_HEMI_SKY = 0x6f7fcf;
const NIGHT_HEMI_GROUND = 0x2c2a55;

const SUN_WHITE = 0xfff1da;
const SUN_GOLD = 0xff9a52;

const CHARACTER_DAY = [1, 0.97, 0.92] as const;
const CHARACTER_GOLD = [1, 0.88, 0.76] as const;
const CHARACTER_NIGHT = [0.62, 0.68, 0.95] as const;

interface RgbaColor {
  readonly color: number;
  readonly alpha: number;
}

interface BackdropSet {
  readonly bg: number;
  readonly glow: number;
  readonly edge: number;
  readonly dot: RgbaColor;
}

const BACKDROP_DAY: BackdropSet = { bg: 0xf6ead9, glow: 0xfff8ec, edge: 0xecd9bf, dot: { color: 0xa06e3c, alpha: 0.1 } };
const BACKDROP_GOLD: BackdropSet = { bg: 0xf5d5b3, glow: 0xffe6c4, edge: 0xe2bb90, dot: { color: 0xa0502a, alpha: 0.1 } };
const BACKDROP_DUSK: BackdropSet = { bg: 0x40355f, glow: 0x7a4f6c, edge: 0x1b1633, dot: { color: 0xd0a0c8, alpha: 0.07 } };
const BACKDROP_NIGHT: BackdropSet = { bg: 0x121733, glow: 0x232b5c, edge: 0x0a0d20, dot: { color: 0xa0afff, alpha: 0.07 } };

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function cssRgba({ color, alpha }: RgbaColor): string {
  return `rgba(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}, ${alpha.toFixed(3)})`;
}

function mix3(a: readonly [number, number, number] | readonly number[], b: readonly number[], t: number): [number, number, number] {
  const channel = (i: number): number => (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;
  return [channel(0), channel(1), channel(2)];
}

function backdropFor(daylight: Daylight): Backdrop {
  const { dayFactor, golden } = daylight;
  const mixSet = (a: BackdropSet, b: BackdropSet, t: number): BackdropSet => ({
    bg: mixColor(a.bg, b.bg, t),
    glow: mixColor(a.glow, b.glow, t),
    edge: mixColor(a.edge, b.edge, t),
    dot: { color: mixColor(a.dot.color, b.dot.color, t), alpha: a.dot.alpha + (b.dot.alpha - a.dot.alpha) * t },
  });
  const day = mixSet(BACKDROP_DAY, BACKDROP_GOLD, golden);
  // Through twilight the page passes by a dusky mauve rather than a muddy grey between navy and cream.
  const dusk = mixSet(BACKDROP_DUSK, day, smoothstep(0.35, 1, dayFactor));
  const blended = mixSet(BACKDROP_NIGHT, dusk, smoothstep(0, 0.5, dayFactor));
  return { bg: css(blended.bg), glow: css(blended.glow), edge: css(blended.edge), dot: cssRgba(blended.dot) };
}

function groupLevels(daylight: Daylight, context: LightingContext): Record<LightGroup, number> {
  const lamps = daylight.lampFactor;
  const { phase, occupied } = context;
  const staffed = phase !== 'off';
  const level = (zone: ZoneId, working = 1): number =>
    lamps * (staffed || occupied.has(zone) ? working : SECURITY_LEVEL * working);
  const asleep = phase === 'off';
  // Ceiling light in the dorm only while somebody is up; the bedside night-lights stay low while they sleep.
  const dormCeiling = lamps * (asleep ? 0 : 0.5);
  return {
    workspace: level('workspace'),
    corridor: level('corridor'),
    'meeting-a': level('meeting-a'),
    'meeting-b': level('meeting-b'),
    mailroom: level('mailroom'),
    approvals: level('approvals'),
    kitchen: level('kitchen', 0.95),
    hall: level('hall', 0.9),
    dormitory: dormCeiling,
    games: level('games', 0.85),
    dormNight: lamps * (asleep ? 0.85 : 0.3),
    poolTable: level('games'),
    tv: context.tvOn ? 0.3 + 0.7 * lamps : 0,
  };
}

/** Everything the scene needs for one daylight sample and office situation. */
export function lightLevels(daylight: Daylight, context: LightingContext): LightLevels {
  const { dayFactor, golden, sunStrength } = daylight;
  const daySky = mixColor(DAY_HEMI_SKY, GOLD_HEMI_SKY, golden);
  const dayGround = mixColor(DAY_HEMI_GROUND, GOLD_HEMI_GROUND, golden);
  // The real sun drops from about 1.9 at midday to ~1 when it is low and golden.
  const elevationK = smoothstep(2, 40, daylight.elevation);
  const sunIntensity = sunStrength * (0.9 + 1.1 * elevationK);
  const character = mix3(CHARACTER_NIGHT, mix3(CHARACTER_DAY, CHARACTER_GOLD, golden), dayFactor);
  return {
    hemiSky: mixColor(NIGHT_HEMI_SKY, daySky, dayFactor),
    hemiGround: mixColor(NIGHT_HEMI_GROUND, dayGround, dayFactor),
    hemiIntensity: 0.58 + (1.05 - 0.58) * dayFactor - golden * 0.12 * dayFactor,
    sunColor: mixColor(SUN_WHITE, SUN_GOLD, golden),
    sunIntensity,
    fillIntensity: 0.3 * dayFactor,
    exposure: 1.12 - 0.12 * dayFactor,
    character: [character[0], character[1], character[2]],
    contactOpacity: 0.55 - 0.13 * dayFactor,
    groups: groupLevels(daylight, context),
    backdrop: backdropFor(daylight),
  };
}
