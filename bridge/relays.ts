// The relays the bridge publishes to: from repeated `--relay` flags (all sharing the default token) or from
// ~/.config/orbs-office/relays.json (one token file per relay). Parsing is pure; file access is injected.

import type { Result } from '../shared/public-snapshot';

export interface RelayTarget {
  /** Short label used in the log. */
  name: string;
  url: string;
  token: string;
}

export const MAX_RELAYS = 5;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ENTRY_KEYS = ['name', 'url', 'tokenFile'];

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The publish token travels in a header: never over plaintext to a non-local host. */
export function validateRelayUrl(relay: string): Result<URL> {
  const url = URL.parse(relay);
  if (url === null || (url.protocol !== 'wss:' && url.protocol !== 'ws:')) return fail('relay URL must be ws:// or wss://');
  if (url.protocol === 'ws:' && !LOOPBACK_HOSTS.has(url.hostname)) return fail('refusing plaintext ws:// to a non-local relay; use wss://');
  return { ok: true, value: url };
}

/** Targets from `--relay` URLs; they all use the one default token. Names are the relay's host. */
export function targetsFromUrls(urls: readonly string[], token: string): Result<RelayTarget[]> {
  if (urls.length > MAX_RELAYS) return fail(`at most ${MAX_RELAYS} relays`);
  const targets: RelayTarget[] = [];
  for (const raw of urls) {
    const checked = validateRelayUrl(raw);
    if (!checked.ok) return checked;
    if (targets.some((target) => target.url === checked.value.toString())) return fail('the same relay is listed twice');
    targets.push({ name: checked.value.host, url: checked.value.toString(), token });
  }
  return { ok: true, value: targets };
}

export interface RelayFileDeps {
  /** Turns `~/x` into an absolute path. */
  expandPath(path: string): string;
  /** Reads one token file; the caller enforces its permissions. */
  readToken(path: string): Result<string>;
}

/** Validates the contents of relays.json. Messages name the entry and field, never a token. */
export function parseRelaysFile(text: string, deps: RelayFileDeps): Result<RelayTarget[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('relays.json: not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_RELAYS) return fail(`relays.json: expected 1 to ${MAX_RELAYS} entries`);
  const targets: RelayTarget[] = [];
  for (const [index, entry] of parsed.entries()) {
    const path = `relays.json[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return fail(`${path}: not an object`);
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).some((key) => !ENTRY_KEYS.includes(key))) return fail(`${path}: unexpected key`);
    const { name, url, tokenFile } = record;
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return fail(`${path}.name: letters, digits and dashes, 1 to 32 characters`);
    if (typeof url !== 'string') return fail(`${path}.url: missing`);
    if (typeof tokenFile !== 'string' || tokenFile.length === 0) return fail(`${path}.tokenFile: missing`);
    const checked = validateRelayUrl(url);
    if (!checked.ok) return fail(`${path}.url: ${checked.error}`);
    if (targets.some((target) => target.name === name)) return fail(`${path}.name: listed twice`);
    if (targets.some((target) => target.url === checked.value.toString())) return fail(`${path}.url: listed twice`);
    const token = deps.readToken(deps.expandPath(tokenFile));
    if (!token.ok) return fail(`${path}.tokenFile: ${token.error}`);
    targets.push({ name, url: checked.value.toString(), token: token.value });
  }
  return { ok: true, value: targets };
}
