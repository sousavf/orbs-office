// The one source of "what time is it in the office". Everything that depends on the time of day
// (the work/lunch/sleep schedule, the mailroom board, daylight) reads it from here, so every viewer
// sees the same phase wherever their device is.
//
// The zone comes from `<meta name="office-timezone" content="Europe/Luxembourg">` in the page. The
// public page sets it (change it in `public.html`); the private app has no such tag and keeps using the
// device's own clock.

const META_NAME = 'office-timezone';

export interface OfficeParts {
  /** 0 (Sunday) to 6 (Saturday). */
  readonly day: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** Minutes after local midnight, fractional. */
  readonly minuteOfDay: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let zone: string | null | undefined;
let formatter: Intl.DateTimeFormat | null = null;

/** The office's IANA time zone, or null to use the device's own. An unknown zone name counts as unset. */
export function officeTimeZone(): string | null {
  if (zone !== undefined) return zone;
  const content = document.querySelector(`meta[name="${META_NAME}"]`)?.getAttribute('content')?.trim() ?? '';
  zone = null;
  if (content !== '') {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: content,
        hourCycle: 'h23',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
      zone = content;
    } catch {
      formatter = null;
    }
  }
  return zone;
}

/** Day of week and wall-clock time at `timestamp` in the office's zone. */
export function officeParts(timestamp: number): OfficeParts {
  if (officeTimeZone() === null || formatter === null) {
    const date = new Date(timestamp);
    const seconds = date.getSeconds() + date.getMilliseconds() / 1000;
    return {
      day: date.getDay(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
      seconds: Math.floor(seconds),
      minuteOfDay: date.getHours() * 60 + date.getMinutes() + seconds / 60,
    };
  }
  const fields: Record<string, string> = {};
  for (const part of formatter.formatToParts(timestamp)) fields[part.type] = part.value;
  const hours = Number(fields.hour ?? 0) % 24;
  const minutes = Number(fields.minute ?? 0);
  const seconds = Number(fields.second ?? 0);
  return {
    day: WEEKDAYS[fields.weekday ?? ''] ?? 0,
    hours,
    minutes,
    seconds,
    minuteOfDay: hours * 60 + minutes + seconds / 60,
  };
}

/**
 * A Date whose *local* getters (getDay, getHours, ...) read the office's wall-clock time, which is
 * what the schedule code expects. With no office zone it is simply `new Date(timestamp)`.
 */
export function toOfficeDate(timestamp: number): Date {
  if (officeTimeZone() === null) return new Date(timestamp);
  const parts = officeParts(timestamp);
  const base = new Date(timestamp);
  const shifted = new Date(base.getFullYear(), base.getMonth(), base.getDate(), parts.hours, parts.minutes, parts.seconds, base.getMilliseconds());
  // The device date can differ from the office date around midnight; align the calendar day.
  const dayDelta = ((parts.day - shifted.getDay() + 10) % 7) - 3;
  shifted.setDate(shifted.getDate() + dayDelta);
  return shifted;
}

/** `HH:MM` (24 h) at `timestamp` in the office's zone. */
export function formatOfficeClock(timestamp: number): string {
  const zoneName = officeTimeZone();
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(zoneName === null ? {} : { timeZone: zoneName }),
  });
}
