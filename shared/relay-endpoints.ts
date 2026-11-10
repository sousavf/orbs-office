// The public page's list of live endpoints in priority order, written once as `<meta name="office-relays">` in
// public.html. The page reads it at runtime to fail over; the build reads it to derive the CSP `connect-src`.
// Runtime-neutral (no DOM): the page passes its own origin in.

import type { Result } from './public-snapshot';

export const MAX_RELAY_ENDPOINTS = 5;
/** The page's own host: today's behaviour, and what the page uses when the meta is missing. */
export const SELF_ENDPOINT = 'self';

export type RelaySpec = { kind: 'self' } | { kind: 'remote'; wsOrigin: string; httpOrigin: string };

export interface ResolvedEndpoint {
  /** WebSocket URL of the viewer socket. */
  liveUrl: string;
  /** Origin for `/state.json` and `/healthz`; empty for the page's own host (relative URLs). */
  httpBase: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function parseEntry(entry: string): Result<RelaySpec> {
  if (entry === SELF_ENDPOINT) return { ok: true, value: { kind: 'self' } };
  const url = URL.parse(entry);
  if (url === null || (url.protocol !== 'wss:' && url.protocol !== 'ws:')) return fail(`relay "${entry}": expected wss://host, ws://localhost or "self"`);
  // Plaintext is for local testing only: the page would otherwise leak viewer traffic and could be downgraded.
  if (url.protocol === 'ws:' && !LOOPBACK_HOSTS.has(url.hostname)) return fail(`relay "${entry}": ws:// is only allowed for localhost`);
  if (url.origin === 'null' || entry.replace(/\/$/, '') !== `${url.protocol}//${url.host}`) return fail(`relay "${entry}": give an origin only, without a path`);
  const httpOrigin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
  return { ok: true, value: { kind: 'remote', wsOrigin: `${url.protocol}//${url.host}`, httpOrigin } };
}

/** Parses the meta's comma-separated content. Missing or empty means the page's own host only. */
export function parseRelayList(content: string | null | undefined): Result<RelaySpec[]> {
  const entries = (content ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length === 0) return { ok: true, value: [{ kind: 'self' }] };
  if (entries.length > MAX_RELAY_ENDPOINTS) return fail(`at most ${MAX_RELAY_ENDPOINTS} relays`);
  const specs: RelaySpec[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (!parsed.ok) return parsed;
    const key = parsed.value.kind === 'self' ? SELF_ENDPOINT : parsed.value.wsOrigin;
    if (seen.has(key)) return fail(`relay "${entry}": listed twice`);
    seen.add(key);
    specs.push(parsed.value);
  }
  return { ok: true, value: specs };
}

/** Binds the list to the page's origin, e.g. `https://office.example`. */
export function resolveEndpoints(specs: readonly RelaySpec[], pageOrigin: string): ResolvedEndpoint[] {
  const page = new URL(pageOrigin);
  const selfWs = `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}`;
  return specs.map((spec) =>
    spec.kind === 'self'
      ? { liveUrl: `${selfWs}/live`, httpBase: '' }
      : { liveUrl: `${spec.wsOrigin}/live`, httpBase: spec.httpOrigin },
  );
}

/** CSP `connect-src` sources for the remote endpoints: the socket, plus HTTPS for polling and health probes. `self` needs none. */
export function remoteConnectSources(specs: readonly RelaySpec[]): string[] {
  return specs.flatMap((spec) => (spec.kind === 'remote' ? [spec.wsOrigin, spec.httpOrigin] : []));
}

const META_PATTERN = /<meta\s+name="office-relays"\s+content="([^"]*)"\s*\/?>/;

/** Reads the meta out of the page's HTML (build time). */
export function relayListFromHtml(html: string): Result<RelaySpec[]> {
  return parseRelayList(META_PATTERN.exec(html)?.[1]);
}

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const HOSTS_META_PATTERN = /<meta\s+name="office-hosts"\s+content="([^"]*)"\s*\/?>/;

/** Hostnames the page is served from (`<meta name="office-hosts">`); the CSP names each one explicitly. */
export function parsePageHosts(content: string | null | undefined): Result<string[]> {
  const hosts: string[] = [];
  for (const entry of (content ?? '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (host.length === 0) continue;
    if (!HOST_PATTERN.test(host)) return fail(`host "${host}": expected a bare hostname like office.example`);
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { ok: true, value: hosts };
}

export function pageHostsFromHtml(html: string): Result<string[]> {
  return parsePageHosts(HOSTS_META_PATTERN.exec(html)?.[1]);
}

/** `wss://` and `https://` entries for every page hostname. */
export function pageHostConnectSources(hosts: readonly string[]): string[] {
  return hosts.flatMap((host) => [`wss://${host}`, `https://${host}`]);
}
