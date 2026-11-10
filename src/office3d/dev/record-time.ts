// Dev-only (`?preview&record`): replaces every time source with a virtual clock that only moves when
// `advance` is called, so footage can be rendered frame by frame at any speed. Imported first by
// main.ts, before anything captures `Date.now`, a timer or `requestAnimationFrame`.

interface Timer {
  readonly id: number;
  at: number;
  readonly run: () => void;
  readonly every: number | null;
}

type FrameCallback = (time: number) => void;

const params = new URLSearchParams(window.location.search);
/** Local noon-ish start: 12 May 2026, 09:30, so the sun is high and the office is on the clock. */
const START = new Date(2026, 4, 12, 9, 30, 0, 0).getTime();

let perf = 0;
let dateBase = START;
let dateElapsed = 0;
let dateScale = 1;
let nextId = 1;
let timers: Timer[] = [];
let frames = new Map<number, FrameCallback>();
let seed = Number.parseInt(params.get('seed') ?? '', 10);
if (Number.isNaN(seed)) seed = 20260512;

/** mulberry32: small, fast and good enough to make every run of the office identical. */
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function addTimer(handler: TimerHandler, delay: number | undefined, every: boolean, args: unknown[]): number {
  const wait = Math.max(0, delay ?? 0);
  const run = typeof handler === 'function' ? (): void => void handler(...args) : (): void => undefined;
  const id = nextId++;
  timers.push({ id, at: perf + wait, run, every: every ? Math.max(1, wait) : null });
  return id;
}

function clearTimer(id: number | undefined): void {
  timers = timers.filter((timer) => timer.id !== id);
}

window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => addTimer(handler, delay, false, args)) as typeof window.setTimeout;
window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => addTimer(handler, delay, true, args)) as typeof window.setInterval;
window.clearTimeout = clearTimer;
window.clearInterval = clearTimer;
window.requestAnimationFrame = (callback: FrameCallback): number => {
  const id = nextId++;
  frames.set(id, callback);
  return id;
};
window.cancelAnimationFrame = (id: number): void => {
  frames.delete(id);
};
performance.now = (): number => perf;
Date.now = (): number => dateBase + dateElapsed;
Math.random = random;

const seen = new WeakMap<Animation, number>();

/** CSS animations and transitions on the overlays follow the virtual clock too. */
function syncAnimations(): void {
  for (const animation of document.getAnimations()) {
    const start = seen.get(animation) ?? perf;
    seen.set(animation, start);
    animation.pause();
    animation.currentTime = perf - start;
  }
}

/** Advances the virtual clock by `dtMs`: due timers, then the animation-frame callbacks (the render loop). */
export function advance(dtMs: number): void {
  const target = perf + dtMs;
  for (;;) {
    const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
    if (due === undefined) break;
    perf = Math.max(perf, due.at);
    if (due.every === null) timers = timers.filter((timer) => timer !== due);
    else due.at += due.every;
    due.run();
  }
  perf = target;
  dateElapsed += dtMs * dateScale;
  const callbacks = [...frames.entries()];
  frames = new Map();
  for (const [, callback] of callbacks) callback(perf);
  syncAnimations();
}

/** Puts the office wall clock at `HH:MM` on the recording day, or on `date` (`YYYY-MM-DD`) when given. */
export function setClock(time: string, date?: string): void {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const [year = 2026, month = 5, day = 12] = date === undefined ? [] : date.split('-').map(Number);
  dateBase = new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
  dateElapsed = 0;
}

/** How many office seconds pass per recorded second (1 = real time); for time-lapses. */
export function setClockScale(scale: number): void {
  dateBase += dateElapsed;
  dateElapsed = 0;
  dateScale = scale;
}
