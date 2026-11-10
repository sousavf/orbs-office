import type { PublicIsland } from '../../shared/public-snapshot';
import type { IslandSource } from '../office-contracts';
import { createIslandStore, withLocalFallback } from './office-settings-store';

/** Which island (or solo desk) each bot is set to sit at; `auto` until the owner picks. */
export interface IslandPrefs extends IslandSource {
  /** Resolves true once saved; false when the choice is only held in memory and will be retried. */
  set(botId: string, island: PublicIsland): Promise<boolean>;
}

export function createIslandPrefs(): IslandPrefs {
  return withLocalFallback(createIslandStore(), 'auto');
}
