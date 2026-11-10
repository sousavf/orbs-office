import { type Clock, type Timer, cancelTimer } from './clock';

const WANDER_MS: readonly [number, number] = [3000, 7000];
const CHAT_MS: readonly [number, number] = [4000, 10000];
/** Over lunch the table talks more. */
const LUNCH_CHAT_MS: readonly [number, number] = [2500, 6000];
const REPLY_DELAY_MS = 800;
const REPLY_CHANCE = 0.5;
const LINES: readonly string[] = [
  'bla bla',
  'hmm...',
  'haha',
  'so anyway',
  'nice',
  'brb',
  'did you see that?',
  'lol',
  'coffee?',
  'mhm',
  'wait what',
  'same',
];

export type LifeMode = 'kitchen' | 'lunch';

export interface KitchenHooks {
  wander(): void;
  speak(line: string): void;
  neighbour(): KitchenLife | null;
}

function between([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function randomLine(): string {
  return LINES[Math.floor(Math.random() * LINES.length)] ?? 'hmm...';
}

/** Timers for an idle bot settled in the kitchen: now and then wander, now and then chat. */
export class KitchenLife {
  private wanderTimer: Timer | null = null;
  private chatTimer: Timer | null = null;
  private replyTimer: Timer | null = null;
  private running = false;
  private mode: LifeMode = 'kitchen';

  constructor(
    private readonly clock: Clock,
    private readonly hooks: KitchenHooks,
  ) {}

  get active(): boolean {
    return this.running;
  }

  /** Kitchen bots wander and chat now and then; bots at lunch stay seated and chat more. */
  start(mode: LifeMode = 'kitchen'): void {
    if (this.running && this.mode === mode) return;
    this.stop();
    this.mode = mode;
    this.running = true;
    if (mode === 'kitchen') this.scheduleWander();
    this.scheduleChat();
  }

  stop(): void {
    this.running = false;
    this.wanderTimer = cancelTimer(this.wanderTimer);
    this.chatTimer = cancelTimer(this.chatTimer);
    this.replyTimer = cancelTimer(this.replyTimer);
  }

  /** Called on the listener when a neighbour speaks; answers some of the time. */
  reply(): void {
    if (!this.running || this.replyTimer !== null || Math.random() >= REPLY_CHANCE) return;
    this.replyTimer = this.clock.after(REPLY_DELAY_MS, () => {
      this.replyTimer = null;
      this.hooks.speak(randomLine());
    });
  }

  private scheduleWander(): void {
    this.wanderTimer = this.clock.after(between(WANDER_MS), () => {
      this.wanderTimer = null;
      this.hooks.wander();
    });
  }

  private scheduleChat(): void {
    this.chatTimer = this.clock.after(between(this.mode === 'lunch' ? LUNCH_CHAT_MS : CHAT_MS), () => {
      this.chatTimer = null;
      const neighbour = this.hooks.neighbour();
      if (neighbour !== null) {
        this.hooks.speak(randomLine());
        neighbour.reply();
      }
      this.scheduleChat();
    });
  }
}
