import { BOT_ID_PATTERN } from '../../shared/office-settings';
import type { Figure, FigureSource } from '../office-contracts';
import { createFigureSectionStore, getOfficeSettingsClient } from './office-settings-store';

export interface FigurePrefs extends FigureSource {
  /** Resolves true once saved; false when the choice is only held in memory and will be retried. */
  set(botId: string, figure: Figure): Promise<boolean>;
}

const LEGACY_STORAGE_KEY = 'orbs-office.figures';

function isFigure(value: unknown): value is Figure {
  return value === 'male' || value === 'female';
}

function readLegacy(): Map<string, Figure> {
  const figures = new Map<string, Figure>();
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return figures;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return figures;
    for (const [botId, figure] of Object.entries(parsed)) {
      if (BOT_ID_PATTERN.test(botId) && isFigure(figure)) figures.set(botId, figure);
    }
  } catch {
    // Corrupt or unavailable storage: nothing to import.
  }
  return figures;
}

/** One-time move of the old per-browser choices into the shared settings file. */
async function importLegacy(): Promise<void> {
  const client = getOfficeSettingsClient();
  if (!(await client.whenLoaded())) return;
  let hasKey = false;
  try {
    hasKey = localStorage.getItem(LEGACY_STORAGE_KEY) !== null;
  } catch {
    return;
  }
  if (!hasKey) return;
  const legacy = readLegacy();
  const saved = legacy.size === 0 || await client.update((settings) => {
    // Choices already in the shared file win over this browser's old ones.
    const figures = { ...Object.fromEntries(legacy), ...settings.figures };
    return { ...settings, figures };
  });
  if (!saved) return;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage unavailable: the key will be retried next load.
  }
}

/**
 * Which figure each bot is drawn with. Stored in the owner's shared settings file
 * (via the dev server's /office-settings), so every tab and browser agrees. Falls back to
 * memory when the endpoint is unreachable, and for ids that are not bot UUIDs (preview feed).
 */
export function createFigurePrefs(): FigurePrefs {
  const store = createFigureSectionStore();
  const local = new Map<string, Figure>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  store.subscribe(notify);
  void importLegacy();

  return {
    get: (botId) => (BOT_ID_PATTERN.test(botId) ? store.get(botId) : (local.get(botId) ?? 'male')),
    set(botId, figure) {
      if (BOT_ID_PATTERN.test(botId)) {
        return store.set(botId, figure);
      }
      if ((local.get(botId) ?? 'male') !== figure) {
        local.set(botId, figure);
        notify();
      }
      return Promise.resolve(true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
