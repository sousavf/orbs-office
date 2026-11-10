/** Eases a value between 0 and 1 over a fixed time; `value` is read each frame. */
export class Fade {
  value: number;
  private from: number;
  private goal: number;
  private elapsed = 0;
  private duration = 0;
  private onDone: (() => void) | null = null;

  constructor(initial: number) {
    this.value = initial;
    this.from = initial;
    this.goal = initial;
  }

  get running(): boolean {
    return this.elapsed < this.duration;
  }

  /** Starts easing to `target`; a zero duration jumps there and calls `done` at once. */
  ease(target: number, durationMs: number, done?: () => void): void {
    this.from = this.value;
    this.goal = target;
    this.elapsed = 0;
    this.duration = durationMs;
    this.onDone = done ?? null;
    if (durationMs <= 0) this.finish();
  }

  /** Advances by `deltaMs`; returns true while the value changed. */
  update(deltaMs: number): boolean {
    if (!this.running) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + deltaMs);
    if (this.elapsed >= this.duration) {
      this.finish();
      return true;
    }
    const t = this.elapsed / this.duration;
    this.value = this.from + (this.goal - this.from) * t * t * (3 - 2 * t);
    return true;
  }

  private finish(): void {
    this.value = this.goal;
    this.duration = 0;
    this.elapsed = 0;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }
}
