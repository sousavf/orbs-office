// Owner's office settings, shared by the dev server, the bridge and every browser.

import { ISLANDS, ISLAND_NAME_PATTERN, PUBLIC_NAME_PATTERN } from './public-snapshot';
import type { PublicFigure, PublicIsland, Result } from './public-snapshot';

export const MAX_SETTINGS_BYTES = 256 * 1024;
export const MAX_SETTINGS_BOTS = 256;

export const BOT_ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Island letters that can carry a custom sign name. */
export const ISLAND_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type IslandLetter = (typeof ISLAND_LETTERS)[number];

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The office day. Days are 0 (Sunday) to 6 (Saturday); times are local `HH:MM`. */
export interface WorkingHours {
  enabled: boolean;
  days: number[];
  start: string;
  end: string;
  lunchStart: string;
  lunchEnd: string;
}

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  enabled: true,
  days: [1, 2, 3, 4, 5],
  start: '07:00',
  end: '19:00',
  lunchStart: '12:30',
  lunchEnd: '14:00',
};

/** What lights the 3D scene: the time of day, or a fixed day or night. */
export const LIGHTING_MODES = ['clock', 'day', 'night'] as const;
export type LightingMode = (typeof LIGHTING_MODES)[number];
export const DEFAULT_LIGHTING_MODE: LightingMode = 'clock';

export interface LightingSettings {
  mode: LightingMode;
}

export interface OfficeSettings {
  figures: Record<string, PublicFigure>;
  islands: Record<string, PublicIsland>;
  publicNames: Record<string, string>;
  /** Sign names of the islands; letters without an entry keep their default name. */
  islandNames?: Partial<Record<IslandLetter, string>>;
  workingHours?: WorkingHours;
  lighting?: LightingSettings;
}

export function emptySettings(): OfficeSettings {
  return { figures: {}, islands: {}, publicNames: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entries(value: unknown, path: string): Result<[string, unknown][]> {
  if (!isRecord(value)) return { ok: false, error: `${path}: not an object` };
  const list = Object.entries(value);
  if (list.length > MAX_SETTINGS_BOTS) return { ok: false, error: `${path}: too many entries` };
  for (const [key] of list) {
    if (!BOT_ID_PATTERN.test(key)) return { ok: false, error: `${path}: invalid bot id` };
  }
  return { ok: true, value: list };
}

export function validateIslandNames(value: unknown): Result<Partial<Record<IslandLetter, string>>> {
  if (!isRecord(value)) return { ok: false, error: 'islandNames: not an object' };
  const names: Partial<Record<IslandLetter, string>> = {};
  for (const [key, name] of Object.entries(value)) {
    const letter = ISLAND_LETTERS.find((candidate) => candidate === key);
    if (letter === undefined) return { ok: false, error: 'islandNames: unknown island' };
    if (typeof name !== 'string' || !ISLAND_NAME_PATTERN.test(name) || name.trim().length === 0) {
      return { ok: false, error: 'islandNames: invalid value' };
    }
    names[letter] = name;
  }
  return { ok: true, value: names };
}

export function validateWorkingHours(value: unknown): Result<WorkingHours> {
  if (!isRecord(value)) return { ok: false, error: 'workingHours: not an object' };
  const keys = ['enabled', 'days', 'start', 'end', 'lunchStart', 'lunchEnd'];
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) return { ok: false, error: 'workingHours: unexpected key' };
  }
  const { enabled, days, start, end, lunchStart, lunchEnd } = value;
  if (typeof enabled !== 'boolean') return { ok: false, error: 'workingHours.enabled: invalid' };
  if (!Array.isArray(days) || days.length > 7) return { ok: false, error: 'workingHours.days: invalid' };
  const list: number[] = [];
  for (const day of days) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6 || list.includes(day)) {
      return { ok: false, error: 'workingHours.days: invalid' };
    }
    list.push(day);
  }
  for (const [name, time] of [['start', start], ['end', end], ['lunchStart', lunchStart], ['lunchEnd', lunchEnd]] as const) {
    if (typeof time !== 'string' || !TIME_PATTERN.test(time)) return { ok: false, error: `workingHours.${name}: invalid` };
  }
  const [s, e, ls, le] = [start, end, lunchStart, lunchEnd] as string[];
  if (s === undefined || e === undefined || ls === undefined || le === undefined) return { ok: false, error: 'workingHours: invalid' };
  if (!(s < e)) return { ok: false, error: 'workingHours: start must be before end' };
  if (!(s <= ls && ls < le && le <= e)) return { ok: false, error: 'workingHours: lunch must lie within the day' };
  return { ok: true, value: { enabled, days: list.sort((a, b) => a - b), start: s, end: e, lunchStart: ls, lunchEnd: le } };
}

export function validateLighting(value: unknown): Result<LightingSettings> {
  if (!isRecord(value)) return { ok: false, error: 'lighting: not an object' };
  for (const key of Object.keys(value)) {
    if (key !== 'mode') return { ok: false, error: 'lighting: unexpected key' };
  }
  if (value.mode === undefined) return { ok: true, value: { mode: DEFAULT_LIGHTING_MODE } };
  const mode = LIGHTING_MODES.find((candidate) => candidate === value.mode);
  if (mode === undefined) return { ok: false, error: 'lighting.mode: invalid' };
  return { ok: true, value: { mode } };
}

export function validateOfficeSettings(value: unknown): Result<OfficeSettings> {
  if (!isRecord(value)) return { ok: false, error: 'settings: not an object' };
  for (const key of Object.keys(value)) {
    if (!['figures', 'islands', 'publicNames', 'islandNames', 'workingHours', 'lighting'].includes(key)) {
      return { ok: false, error: 'settings: unexpected key' };
    }
  }
  const result = emptySettings();

  const figures = entries(value.figures, 'figures');
  if (!figures.ok) return figures;
  for (const [id, figure] of figures.value) {
    if (figure !== 'male' && figure !== 'female') return { ok: false, error: 'figures: invalid value' };
    result.figures[id] = figure;
  }

  const islands = entries(value.islands, 'islands');
  if (!islands.ok) return islands;
  for (const [id, island] of islands.value) {
    if (typeof island !== 'string' || !(ISLANDS as readonly string[]).includes(island)) {
      return { ok: false, error: 'islands: invalid value' };
    }
    result.islands[id] = island as PublicIsland;
  }

  const names = entries(value.publicNames, 'publicNames');
  if (!names.ok) return names;
  for (const [id, name] of names.value) {
    if (typeof name !== 'string' || !PUBLIC_NAME_PATTERN.test(name) || name.trim().length === 0) {
      return { ok: false, error: 'publicNames: invalid value' };
    }
    result.publicNames[id] = name;
  }

  if (value.islandNames !== undefined) {
    const parsed = validateIslandNames(value.islandNames);
    if (!parsed.ok) return parsed;
    result.islandNames = parsed.value;
  }

  if (value.workingHours !== undefined) {
    const parsed = validateWorkingHours(value.workingHours);
    if (!parsed.ok) return parsed;
    result.workingHours = parsed.value;
  }

  if (value.lighting !== undefined) {
    const parsed = validateLighting(value.lighting);
    if (!parsed.ok) return parsed;
    result.lighting = parsed.value;
  }
  return { ok: true, value: result };
}

/** Parses a settings document from text, enforcing the size limit. */
export function parseOfficeSettings(text: string): Result<OfficeSettings> {
  if (text.length > MAX_SETTINGS_BYTES) return { ok: false, error: 'settings: too large' };
  try {
    return validateOfficeSettings(JSON.parse(text));
  } catch {
    return { ok: false, error: 'settings: not JSON' };
  }
}

/** What an island's sign says until the owner renames it (kept equal to the layout's default). */
export function defaultIslandName(letter: IslandLetter): string {
  return `Island ${letter}`;
}
