import { type Clock, type Timer, cancelTimer } from './clock';

const SPEECH_MS = 2000;
const REPLY_BASE_MS = 4000;
const REPLY_PER_CHAR_MS = 50;
const REPLY_MAX_MS = 12_000;

export function replyDurationMs(text: string): number {
  return Math.min(REPLY_MAX_MS, REPLY_BASE_MS + REPLY_PER_CHAR_MS * text.length);
}

/** A short-lived line of kitchen chatter. A state bubble or failure badge suppresses it. */
export class SpeechLine {
  private timer: Timer | null = null;
  private line: string | null = null;
  private suppressed = false;

  constructor(
    private readonly clock: Clock,
    private readonly onChange: () => void,
  ) {}

  /** True while a line is on screen. */
  get active(): boolean {
    return this.line !== null && !this.suppressed;
  }

  get text(): string | null {
    return this.active ? this.line : null;
  }

  say(line: string): void {
    this.line = line;
    this.timer = cancelTimer(this.timer);
    this.timer = this.clock.after(SPEECH_MS, () => this.clear());
    this.onChange();
  }

  clear(): void {
    this.timer = cancelTimer(this.timer);
    this.line = null;
    this.onChange();
  }

  setSuppressed(suppressed: boolean): void {
    if (suppressed === this.suppressed) return;
    this.suppressed = suppressed;
    this.onChange();
  }

  dispose(): void {
    this.timer = cancelTimer(this.timer);
  }
}

/** A bot's latest chat reply: shown for a time that grows with its length. */
export class ReplyLine {
  private timer: Timer | null = null;
  private shown: string | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly onChange: () => void,
  ) {}

  get active(): boolean {
    return this.shown !== null;
  }

  get text(): string | null {
    return this.shown;
  }

  show(text: string): void {
    this.shown = text;
    this.timer = cancelTimer(this.timer);
    this.timer = this.clock.after(replyDurationMs(text), () => this.clear());
    this.onChange();
  }

  clear(): void {
    this.timer = cancelTimer(this.timer);
    if (this.shown === null) return;
    this.shown = null;
    this.onChange();
  }

  dispose(): void {
    this.timer = cancelTimer(this.timer);
  }
}
