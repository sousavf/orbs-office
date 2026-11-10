/** How busy the city is at an office wall-clock time. Pure, so every viewer derives the same numbers. */
export interface CityActivity {
  /** 0..1 share of the car fleet on the road. */
  readonly cars: number;
  /** 0..1 share of the pedestrians on the pavements. */
  readonly walkers: number;
  /** Buses run from early morning until late evening. */
  readonly buses: boolean;
}

type Curve = readonly (readonly [hour: number, level: number])[];

const CAR_CURVE: Curve = [
  [0, 0.12], [5.5, 0.12], [7, 0.8], [8, 1], [9.5, 0.9], [17, 0.9], [18, 1], [19, 0.85],
  [20.5, 0.55], [21.75, 0.28], [22.5, 0.12], [24, 0.12],
];
const WALKER_CURVE: Curve = [
  [0, 0.02], [1, 0], [5, 0], [6.5, 0.1], [8, 0.8], [9.5, 1], [17, 1], [18.5, 0.85],
  [19.5, 0.55], [21, 0.2], [22, 0.07], [23, 0.04], [24, 0.02],
];
const BUS_FIRST_HOUR = 5.5;
const BUS_LAST_HOUR = 23;
/** Weekend daytime traffic is this share of a weekday's. */
const WEEKEND_SHARE = 0.6;

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function sampleCurve(curve: Curve, hour: number): number {
  for (let index = 1; index < curve.length; index++) {
    const next = curve[index];
    const previous = curve[index - 1];
    if (next === undefined || previous === undefined || hour > next[0]) continue;
    const span = next[0] - previous[0];
    return previous[1] + (next[1] - previous[1]) * ease(span <= 0 ? 1 : Math.max(0, (hour - previous[0]) / span));
  }
  return curve.at(-1)?.[1] ?? 0;
}

/** Quiet levels (night) stay as they are; busy daytime levels shrink on weekends. */
function weekendAdjusted(level: number, weekend: boolean): number {
  if (!weekend) return level;
  const busy = ease(Math.min(1, Math.max(0, (level - 0.12) / 0.48)));
  return level * (1 - (1 - WEEKEND_SHARE) * busy);
}

/** `day` is 0 (Sunday) to 6; `minuteOfDay` is fractional minutes after local midnight. */
export function cityActivity(minuteOfDay: number, day: number): CityActivity {
  const hour = (((minuteOfDay / 60) % 24) + 24) % 24;
  const weekend = day === 0 || day === 6;
  return {
    cars: weekendAdjusted(sampleCurve(CAR_CURVE, hour), weekend),
    walkers: weekendAdjusted(sampleCurve(WALKER_CURVE, hour), weekend),
    buses: hour >= BUS_FIRST_HOUR && hour < BUS_LAST_HOUR,
  };
}

/** Seconds an entity takes to shrink into the ground (or grow out of it) when it retires or arrives. */
export const FADE_SECONDS = 1.6;

/**
 * Where entity `index` of `count` sits in the fixed order they appear in: the same shuffled ranks every time,
 * so a density of `d` always shows `round(d * count)` of them, the same ones.
 */
export function appearanceRank(index: number, count: number): number {
  return ((index * 7 + 3) % count + 0.5) / count;
}

export function smoothScale(presence: number): number {
  return ease(presence);
}

/** Moves a presence value toward 0 or 1 at the fade rate. */
export function approachPresence(presence: number, present: boolean, seconds: number): number {
  const step = seconds / FADE_SECONDS;
  return present ? Math.min(1, presence + step) : Math.max(0, presence - step);
}
