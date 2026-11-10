import { normalizeDaemonUrl } from '../orbs/orbs-client';

export interface StoredGrant {
  daemonUrl: string;
  token: string;
  serverId: string;
}

/** Where a feed keeps its pairing grant. The browser default is localStorage; the bridge injects a file. */
export interface GrantStorage {
  load(): StoredGrant | null;
  save(grant: StoredGrant): void;
  clear(): void;
}

const STORAGE_KEY = 'orbs-office.grant';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function loadGrant(): StoredGrant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const daemonUrl: unknown = Reflect.get(parsed, 'daemonUrl');
    const token: unknown = Reflect.get(parsed, 'token');
    const serverId: unknown = Reflect.get(parsed, 'serverId');
    if (typeof daemonUrl !== 'string' || normalizeDaemonUrl(daemonUrl) === null) return null;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    if (typeof serverId !== 'string' || serverId.length === 0) return null;
    return { daemonUrl, token, serverId };
  } catch {
    return null;
  }
}

export function saveGrant(grant: StoredGrant): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grant));
  } catch (error) {
    console.warn('Could not persist the pairing grant', error instanceof Error ? error.name : 'unknown error');
  }
}

export function clearGrant(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was persisted, so nothing to clear.
  }
}

export const browserGrantStorage: GrantStorage = { load: loadGrant, save: saveGrant, clear: clearGrant };
