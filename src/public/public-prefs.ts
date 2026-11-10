import type { PublicBot, PublicFigure, PublicIsland } from '../../shared/public-snapshot';
import type { FigureSource, IslandSource } from '../office-contracts';

/** A read-only, in-memory per-bot value that the feed fills from each snapshot. */
class SnapshotPrefs<T> {
  private values = new Map<string, T>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly fallback: T) {}

  get = (botId: string): T => this.values.get(botId) ?? this.fallback;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Replaces all values; notifies listeners only when something differs. */
  replace(next: Map<string, T>): void {
    let changed = next.size !== this.values.size;
    if (!changed) {
      for (const [id, value] of next) {
        if (this.values.get(id) !== value) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    this.values = next;
    for (const listener of [...this.listeners]) listener();
  }
}

/** Figures and islands for the scene, driven by the snapshot. */
export class PublicPrefs {
  private readonly figureValues = new SnapshotPrefs<PublicFigure>('male');
  private readonly islandValues = new SnapshotPrefs<PublicIsland>('auto');

  readonly figures: FigureSource = this.figureValues;
  readonly islands: IslandSource = this.islandValues;

  update(bots: readonly PublicBot[]): void {
    this.figureValues.replace(new Map(bots.map((bot) => [bot.id, bot.figure])));
    this.islandValues.replace(new Map(bots.map((bot) => [bot.id, bot.island])));
  }
}
