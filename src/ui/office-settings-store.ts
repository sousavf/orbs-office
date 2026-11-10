import { BOT_ID_PATTERN, emptySettings, parseOfficeSettings } from '../../shared/office-settings';
import type { OfficeSettings } from '../../shared/office-settings';

const SETTINGS_URL = '/office-settings';
const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

type Entries<T> = Record<string, NonNullable<T>>;

/**
 * The owner's office settings, kept in the dev server's shared file so every tab and
 * browser sees the same choices. Reads and writes the whole document; unreachable
 * endpoint means the settings live in memory and are retried on the next poll.
 */
export interface OfficeSettingsClient {
  get(): OfficeSettings;
  /** Applies `change` locally at once, then to the freshest shared copy. Resolves true once saved. */
  update(change: (settings: OfficeSettings) => OfficeSettings): Promise<boolean>;
  /** Resolves after the first fetch attempt; true when the shared file was reached. */
  whenLoaded(): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

async function request(init?: RequestInit): Promise<OfficeSettings | null> {
  try {
    const response = await fetch(SETTINGS_URL, { ...init, cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return null;
    const parsed = parseOfficeSettings(await response.text());
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

/** `?preview` never touches the shared file: edits stay in memory for the page's lifetime. */
function isPreview(): boolean {
  return new URLSearchParams(window.location.search).has('preview');
}

function createClient(): OfficeSettingsClient {
  if (isPreview()) return createMemoryClient();
  let settings = emptySettings();
  let serialized = JSON.stringify(settings);
  const pending: ((settings: OfficeSettings) => OfficeSettings)[] = [];
  const listeners = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const adopt = (next: OfficeSettings): void => {
    const text = JSON.stringify(next);
    if (text === serialized) return;
    settings = next;
    serialized = text;
    notify();
  };

  const replay = (base: OfficeSettings): OfficeSettings => pending.reduce((acc, change) => change(acc), base);

  /** Fetches the shared copy, replays unsaved local changes on it and saves when there were any. */
  const sync = async (): Promise<boolean> => {
    const remote = await request();
    if (remote === null) return false;
    if (pending.length === 0) {
      adopt(remote);
      return true;
    }
    const merged = replay(remote);
    const saved = await request({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    });
    if (saved === null) {
      adopt(merged);
      return false;
    }
    pending.length = 0;
    adopt(saved);
    return true;
  };

  const enqueueSync = (): Promise<boolean> => {
    const run = queue.then(sync);
    queue = run.catch(() => false);
    return run;
  };

  const loaded = enqueueSync();
  window.setInterval(() => void enqueueSync(), POLL_INTERVAL_MS);
  window.addEventListener('focus', () => void enqueueSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void enqueueSync();
  });

  return {
    get: () => settings,
    update(change) {
      pending.push(change);
      adopt(change(settings));
      return enqueueSync();
    },
    whenLoaded: () => loaded,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createMemoryClient(): OfficeSettingsClient {
  let settings = emptySettings();
  const listeners = new Set<() => void>();
  return {
    get: () => settings,
    update(change) {
      settings = change(settings);
      for (const listener of [...listeners]) listener();
      return Promise.resolve(true);
    },
    whenLoaded: () => Promise.resolve(false),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let shared: OfficeSettingsClient | null = null;

/** One client per page, shared by all settings stores. */
export function getOfficeSettingsClient(): OfficeSettingsClient {
  shared ??= createClient();
  return shared;
}

export interface SectionStore<T> {
  get(botId: string): T;
  /** Persists the choice; resolves true once saved, false when it is only held in memory (retried later) or the id is not a bot UUID. */
  set(botId: string, value: T): Promise<boolean>;
  /** Calls `listener` after any change, including one made in another tab or browser. */
  subscribe(listener: () => void): () => void;
}

interface Section<T> {
  pick(settings: OfficeSettings): Entries<T>;
  put(settings: OfficeSettings, entries: Entries<T>): OfficeSettings;
  /** Value for ids without an entry; setting it (or null) clears the entry unless `keepDefault`. */
  fallback: T;
  keepDefault?: boolean;
}

function createSectionStore<T>(section: Section<T>): SectionStore<T> {
  const client = getOfficeSettingsClient();
  return {
    get: (botId) => section.pick(client.get())[botId] ?? section.fallback,
    set(botId, value) {
      if (!BOT_ID_PATTERN.test(botId)) return Promise.resolve(false);
      const clears = value === null || (section.keepDefault !== true && value === section.fallback);
      return client.update((settings) => {
        const entries = { ...section.pick(settings) };
        if (clears || value === null || value === undefined) delete entries[botId];
        else entries[botId] = value;
        return section.put(settings, entries);
      });
    },
    subscribe: (listener) => client.subscribe(listener),
  };
}

type Island = OfficeSettings['islands'][string];
type Figure = OfficeSettings['figures'][string];

/** Which island each bot lives on; `auto` until the owner picks one. */
export function createIslandStore(): SectionStore<Island> {
  return createSectionStore<Island>({
    pick: (settings) => settings.islands,
    put: (settings, islands) => ({ ...settings, islands }),
    fallback: 'auto',
  });
}

/** The name shown on the public mirror; null when the owner has not chosen one (set null to clear). */
export function createPublicNameStore(): SectionStore<string | null> {
  return createSectionStore<string | null>({
    pick: (settings) => settings.publicNames,
    put: (settings, publicNames) => ({ ...settings, publicNames }),
    fallback: null,
  });
}

/** Figure per bot; `male` until the owner picks one. */
export function createFigureSectionStore(): SectionStore<Figure> {
  return createSectionStore<Figure>({
    pick: (settings) => settings.figures,
    put: (settings, figures) => ({ ...settings, figures }),
    fallback: 'male',
    keepDefault: true,
  });
}

/**
 * Adds an in-memory copy for ids that are not bot UUIDs (the preview feed's fake bots), which the
 * shared file refuses. Real ids go straight to the store.
 */
export function withLocalFallback<T>(store: SectionStore<T>, fallback: T): SectionStore<T> {
  const local = new Map<string, T>();
  const listeners = new Set<() => void>();
  store.subscribe(() => {
    for (const listener of [...listeners]) listener();
  });
  return {
    get: (botId) => (BOT_ID_PATTERN.test(botId) ? store.get(botId) : (local.get(botId) ?? fallback)),
    set(botId, value) {
      if (BOT_ID_PATTERN.test(botId)) {
        return store.set(botId, value);
      }
      if ((local.get(botId) ?? fallback) !== value) {
        if (value === fallback) local.delete(botId);
        else local.set(botId, value);
        for (const listener of [...listeners]) listener();
      }
      return Promise.resolve(true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
