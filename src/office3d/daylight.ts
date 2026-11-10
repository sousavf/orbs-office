// Pure sun and sky model for the office's scene lighting; no three.js and no DOM, so it is easy to reason about.
//
// The office sits at a fixed place in central Europe (no geolocation request). The wall-clock time handed in
// is the office's (see src/office-clock.ts), converted to solar time with the zone rules of that place, so the sun
// rises and sets at the right times for the season. Scene axes: x is east, z is south (north is -z), y is up.

import type { LightingMode } from '../../shared/office-settings';

/** Luxembourg: central/western Europe, the default office zone. */
export const OFFICE_LATITUDE = 49.6;
export const OFFICE_LONGITUDE = 6.13;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Daylight {
  /** Degrees above the horizon (negative at night). */
  readonly elevation: number;
  /** Degrees clockwise from north. */
  readonly azimuth: number;
  /** Unit vector from the office toward the sun. */
  readonly sunDir: Vec3;
  /** 0 at night to 1 by day, easing through about 45 minutes of twilight. */
  readonly dayFactor: number;
  /** How much of the sun's own light reaches the scene: 0 below the horizon. */
  readonly sunStrength: number;
  /** 0 by day to 1 at night: how far indoor lamps are switched on (they come on at dusk, before it is dark). */
  readonly lampFactor: number;
  /** 1 around sunrise and sunset, 0 at midday and at night: how golden the light is. */
  readonly golden: number;
  /** Sky seen through the windows, top and bottom of the pane. */
  readonly skyTop: number;
  readonly skyBottom: number;
  /** Fraction of the window sky that shows city lights (night only). */
  readonly cityLights: number;
}

const RAD = Math.PI / 180;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear mix of two 0xRRGGBB colours (in sRGB, which is plenty for a sky). */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const channel = (shift: number): number => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * k);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month, day) - Date.UTC(year, 0, 0)) / 86_400_000);
}

function lastSunday(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

/** Offset from UTC in hours (central European time, with summer time) at a wall-clock moment. */
export function officeUtcOffset(year: number, month: number, day: number, hour: number): number {
  const start = lastSunday(year, 2);
  const end = lastSunday(year, 9);
  const afterStart = month > 2 || (month === 2 && (day > start || (day === start && hour >= 2)));
  const beforeEnd = month < 9 || (month === 9 && (day < end || (day === end && hour < 3)));
  return afterStart && beforeEnd ? 2 : 1;
}

/** Solar declination (degrees) and the equation of time (minutes) for a day of the year. */
function solarTerms(dayNumber: number): { declination: number; equationOfTime: number } {
  const b = ((360 / 365) * (dayNumber - 81)) * RAD;
  return {
    declination: 23.44 * Math.sin(b),
    equationOfTime: 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b),
  };
}

export interface SunPosition {
  readonly elevation: number;
  readonly azimuth: number;
}

/** Sun position for office wall-clock fields (month is 0 to 11). */
export function sunPosition(year: number, month: number, day: number, minuteOfDay: number): SunPosition {
  const { declination, equationOfTime } = solarTerms(dayOfYear(year, month, day));
  const offset = officeUtcOffset(year, month, day, Math.floor(minuteOfDay / 60));
  const solarMinutes = minuteOfDay - offset * 60 + 4 * OFFICE_LONGITUDE + equationOfTime;
  return positionAtHourAngle(solarMinutes / 4 - 180, declination);
}

function positionAtHourAngle(hourAngle: number, declination: number): SunPosition {
  const phi = OFFICE_LATITUDE * RAD;
  const delta = declination * RAD;
  const h = hourAngle * RAD;
  const sinEl = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(h);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinEl))) / RAD;
  const fromSouth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi));
  return { elevation, azimuth: (fromSouth / RAD + 180 + 360) % 360 };
}

function directionOf(elevation: number, azimuth: number): Vec3 {
  const el = elevation * RAD;
  const az = azimuth * RAD;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

const SKY_NIGHT_TOP = 0x080d26;
const SKY_NIGHT_BOTTOM = 0x1b2550;
const SKY_DAY_TOP = 0x5fa8e6;
const SKY_DAY_BOTTOM = 0xc4e4f4;
const SKY_GOLDEN_BOTTOM = 0xffb46e;
const SKY_GOLDEN_TOP = 0x8fa6d8;

function sample(elevation: number, azimuth: number): Daylight {
  const dayFactor = smoothstep(-4.5, 5, elevation);
  const golden = (1 - smoothstep(6, 30, elevation)) * smoothstep(-6, 1, elevation);
  const dayTop = mixColor(SKY_DAY_TOP, SKY_GOLDEN_TOP, golden);
  const dayBottom = mixColor(SKY_DAY_BOTTOM, SKY_GOLDEN_BOTTOM, golden);
  return {
    elevation,
    azimuth,
    sunDir: directionOf(elevation, azimuth),
    dayFactor,
    sunStrength: smoothstep(-1, 6, elevation),
    lampFactor: smoothstep(7, -2, elevation),
    golden,
    skyTop: mixColor(SKY_NIGHT_TOP, dayTop, dayFactor),
    skyBottom: mixColor(SKY_NIGHT_BOTTOM, dayBottom, dayFactor),
    cityLights: 1 - smoothstep(-6, 3, elevation),
  };
}

/** Mid-afternoon sun for the always-day mode: about 13:20 solar time on the given date. */
const DAY_MODE_HOUR_ANGLE = 20;

/**
 * The daylight at an office wall-clock moment. `clock` follows the date and time; `day` and `night`
 * pin the stage but keep the season's sun height, so rooms still look like the right time of year.
 */
export function daylightAt(date: Date, mode: LightingMode): Daylight {
  const { declination } = solarTerms(dayOfYear(date.getFullYear(), date.getMonth(), date.getDate()));
  if (mode === 'night') return sample(-30, 0);
  if (mode === 'day') {
    const { elevation, azimuth } = positionAtHourAngle(DAY_MODE_HOUR_ANGLE, declination);
    return sample(Math.max(elevation, 18), azimuth);
  }
  const minuteOfDay = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const { elevation, azimuth } = sunPosition(date.getFullYear(), date.getMonth(), date.getDate(), minuteOfDay);
  return sample(elevation, azimuth);
}
