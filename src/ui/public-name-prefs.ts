import { createPublicNameStore, withLocalFallback } from './office-settings-store';

/** The name each bot has on the public mirror; null falls back to "Agent NN" there. */
export interface PublicNamePrefs {
  get(botId: string): string | null;
  /** Empty or null clears the name. The caller validates the text. */
  /** Resolves true once saved; false when the name is only held in memory and will be retried. */
  set(botId: string, name: string | null): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

export function createPublicNamePrefs(): PublicNamePrefs {
  return withLocalFallback<string | null>(createPublicNameStore(), null);
}
