// The bridge's private files, all in ~/.config/orbs-office with mode 0600.

import { existsSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { GrantStorage, StoredGrant } from '../src/connection/connection-storage';
import { normalizeDaemonUrl } from '../src/orbs/orbs-client';
import { configPath, readPrivateFile, writePrivateFile } from '../shared/settings-file';

const GRANT_FILE = 'bridge-grant.json';
const SECRET_FILE = 'bridge-secret';
const TOKEN_FILE = 'publish-token';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

function parseGrant(text: string): StoredGrant | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { daemonUrl, token, serverId } = parsed as Record<string, unknown>;
    if (typeof daemonUrl !== 'string' || normalizeDaemonUrl(daemonUrl) === null) return null;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    if (typeof serverId !== 'string' || serverId.length === 0) return null;
    return { daemonUrl, token, serverId };
  } catch {
    return null;
  }
}

/** The pairing grant, stored as a file instead of browser localStorage. */
export const fileGrantStorage: GrantStorage = {
  load() {
    const text = readPrivateFile(configPath(GRANT_FILE));
    return text === null ? null : parseGrant(text);
  },
  save: (grant) => writePrivateFile(configPath(GRANT_FILE), JSON.stringify(grant)),
  clear() {
    if (existsSync(configPath(GRANT_FILE))) unlinkSync(configPath(GRANT_FILE));
  },
};

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** The HMAC key behind opaque ids; generated on first run. Losing it only reshuffles public ids. */
export function loadOrCreateSecret(): Uint8Array {
  const existing = readPrivateFile(configPath(SECRET_FILE))?.trim();
  if (existing !== undefined && SECRET_PATTERN.test(existing)) return fromHex(existing);
  const secret = randomBytes(32);
  writePrivateFile(configPath(SECRET_FILE), toHex(secret));
  return secret;
}

/** Publish token from the environment, else from its file; null when neither is set. */
export function loadPublishToken(): string | null {
  const fromEnv = process.env.ORBS_OFFICE_PUBLISH_TOKEN?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const fromFile = readPrivateFile(configPath(TOKEN_FILE))?.trim();
  return fromFile !== undefined && fromFile.length > 0 ? fromFile : null;
}
