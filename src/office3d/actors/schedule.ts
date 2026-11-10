import { DEFAULT_WORKING_HOURS } from '../../../shared/office-settings';
import type { WorkingHours } from '../../../shared/office-settings';
import { toOfficeDate } from '../../office-clock';

export type Phase = 'work' | 'lunch' | 'winddown' | 'off';

/** The last hour before the end of the day. */
const WINDDOWN_MINUTES = 60;
const DAY_NAMES: readonly string[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Which part of the day `date` (local time) falls in. Outside working days and hours the office is
 * `off`; a disabled schedule is always `work`.
 */
export function phaseAt(date: Date, settings: { readonly workingHours?: WorkingHours }): Phase {
  const hours = settings.workingHours ?? DEFAULT_WORKING_HOURS;
  if (!hours.enabled) return 'work';
  if (!hours.days.includes(date.getDay())) return 'off';
  const now = date.getHours() * 60 + date.getMinutes();
  const start = minutesOf(hours.start);
  const end = minutesOf(hours.end);
  if (now < start || now >= end) return 'off';
  if (now >= minutesOf(hours.lunchStart) && now < minutesOf(hours.lunchEnd)) return 'lunch';
  if (now >= end - WINDDOWN_MINUTES) return 'winddown';
  return 'work';
}

export interface ClockOverride {
  /** Minutes after midnight to start the simulated day at, or null for the real time. */
  readonly startMinutes: number | null;
  /** 0 (Sunday) to 6, or null for today. */
  readonly day: number | null;
  readonly timeScale: number;
}

const MAX_TIME_SCALE = 600;

/** `?clock=HH:MM`, `&day=sat` and `&timeScale=N`; malformed values are ignored. */
export function parseClockOverride(search: string): ClockOverride {
  const params = new URLSearchParams(search);
  const clock = params.get('clock');
  const match = clock === null ? null : /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(clock);
  const dayIndex = DAY_NAMES.indexOf((params.get('day') ?? '').slice(0, 3).toLowerCase());
  const scale = Number.parseFloat(params.get('timeScale') ?? '');
  return {
    startMinutes: match === null ? null : Number(match[1]) * 60 + Number(match[2]),
    day: dayIndex >= 0 ? dayIndex : null,
    timeScale: Number.isFinite(scale) && scale > 0 ? Math.min(MAX_TIME_SCALE, scale) : 1,
  };
}

/** Office wall-clock time (the page's office zone, else the device's) for the schedule: the real one, or a simulated one that can start elsewhere and run fast. */
export class ScheduleClock {
  private readonly origin: number;
  private readonly realStart: number;

  constructor(
    private readonly override: ClockOverride | null = null,
    private readonly realNow: () => number = Date.now,
  ) {
    this.realStart = realNow();
    this.origin = this.initialTime();
  }

  /** How many simulated seconds pass per real second. */
  get timeScale(): number {
    return this.override?.timeScale ?? 1;
  }

  now(): Date {
    return toOfficeDate(this.origin + (this.realNow() - this.realStart) * this.timeScale);
  }

  private initialTime(): number {
    const real = new Date(this.realStart);
    const override = this.override;
    if (override === null || (override.startMinutes === null && override.day === null)) return this.realStart;
    const date = new Date(real);
    if (override.startMinutes !== null) date.setHours(Math.floor(override.startMinutes / 60), override.startMinutes % 60, 0, 0);
    if (override.day !== null) date.setDate(date.getDate() + ((override.day - real.getDay() + 7) % 7));
    return date.getTime();
  }
}
