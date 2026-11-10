export interface Timer {
  cancel(): void;
}

interface Entry {
  readonly at: number;
  readonly run: () => void;
  live: boolean;
}

/**
 * Timers on the office loop's own clock, so a paused tab or a slow frame delays them like it
 * delays walking, and tests can step time. Milliseconds throughout.
 */
export class Clock {
  private time = 0;
  private entries: Entry[] = [];

  get now(): number {
    return this.time;
  }

  after(delayMs: number, run: () => void): Timer {
    const entry: Entry = { at: this.time + delayMs, run, live: true };
    this.entries.push(entry);
    return {
      cancel: () => {
        entry.live = false;
      },
    };
  }

  update(deltaMs: number): void {
    this.time += deltaMs;
    if (this.entries.length === 0) return;
    const due = this.entries.filter((entry) => entry.live && entry.at <= this.time).sort((a, b) => a.at - b.at);
    this.entries = this.entries.filter((entry) => entry.live && entry.at > this.time);
    for (const entry of due) {
      if (entry.live) entry.run();
    }
  }
}

/** Cancels a timer held in a nullable slot. */
export function cancelTimer(timer: Timer | null): null {
  timer?.cancel();
  return null;
}
