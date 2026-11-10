// HTTP-level helpers shared by the Worker and the standalone relay: publisher authentication, the viewer Origin rule and
// CORS. Uses only Web Crypto and URL, which exist in Workers, Bun and browsers.

const encoder = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header. Both sides are hashed first, so neither the
 * token's content nor its length leaks through timing.
 */
export async function isAuthorizedBearer(header: string | null, expected: string): Promise<boolean> {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (match === null || match[1] === undefined || expected.length === 0) return false;
  const [given, wanted] = await Promise.all([sha256(match[1]), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < wanted.length; index += 1) difference |= (given[index] ?? 0) ^ (wanted[index] ?? 0);
  return difference === 0;
}

/** Normalises a comma-separated origin list; returns null when any entry is not a plain http(s) origin. */
export function parseOriginList(text: string | undefined): string[] | null {
  const origins: string[] = [];
  for (const entry of (text ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const url = URL.parse(trimmed);
    if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== trimmed.replace(/\/$/, '')) {
      return null;
    }
    origins.push(url.origin);
  }
  return origins;
}

/** A request without an Origin (not a browser) passes; a browser's must be the relay's own origin or a listed one. */
export function isOriginAllowed(origin: string | null, selfOrigin: string, allowed: readonly string[]): boolean {
  if (origin === null) return true;
  const parsed = URL.parse(origin)?.origin;
  return parsed !== undefined && (parsed === selfOrigin || allowed.includes(parsed));
}

/** CORS headers for a listed origin only; a foreign or missing Origin gets none, so browsers refuse to read the response. */
export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const parsed = origin === null ? undefined : URL.parse(origin)?.origin;
  if (parsed === undefined || !allowed.includes(parsed)) return {};
  return { 'Access-Control-Allow-Origin': parsed, Vary: 'Origin' };
}
