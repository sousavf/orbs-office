import { CLIENT_IP_HEADER } from './constants';
import { OfficeRelay } from './office-relay';
import { isAuthorizedBearer, isOriginAllowed } from '../../shared/relay-http';
import { withSecurityHeaders } from './security-headers';

export { OfficeRelay };

const RELAY_NAME = 'main';
function plain(status: number, body = ''): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Polling responses are shared at the edge for a few seconds, so most polls never reach the Durable Object. */
const EDGE_CACHE_CONTROL = 'public, max-age=5, s-maxage=5';

async function cachedFromRelay(request: Request, relay: DurableObjectStub, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET') return relay.fetch(new Request(request));
  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}`);
  const hit = await caches.default.match(key);
  if (hit !== undefined) return hit;
  const fresh = new Response((await relay.fetch(new Request(request))).body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': EDGE_CACHE_CONTROL } });
  ctx.waitUntil(caches.default.put(key, fresh.clone()));
  return fresh;
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const relay = (): DurableObjectStub => env.OFFICE_RELAY.get(env.OFFICE_RELAY.idFromName(RELAY_NAME));

  switch (url.pathname) {
    case '/live': {
      if (request.method !== 'GET') return plain(405);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return plain(426, 'WebSocket required');
      if (!isOriginAllowed(request.headers.get('Origin'), url.origin, [])) return plain(403);
      const forwarded = new Request(request);
      forwarded.headers.set(CLIENT_IP_HEADER, request.headers.get('CF-Connecting-IP') ?? 'unknown');
      return relay().fetch(forwarded);
    }
    case '/publish': {
      if (request.method !== 'GET') return plain(405);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return plain(426, 'WebSocket required');
      if (!(await isAuthorizedBearer(request.headers.get('Authorization'), env.PUBLISH_TOKEN))) return plain(401);
      const forwarded = new Request(request);
      forwarded.headers.delete('Authorization');
      return relay().fetch(forwarded);
    }
    case '/healthz':
      // Lets the page's failover probe check this relay cheaply, without waking the Durable Object.
      return plain(200, 'ok');
    case '/state.json':
    case '/viewers.json':
    case '/snapshot.json': {
      if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405);
      return cachedFromRelay(request, relay(), ctx);
    }
    default:
      return env.ASSETS.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    try {
      return withSecurityHeaders(await route(request, env, ctx), url);
    } catch (error) {
      // Only the error class is logged: never request or message contents.
      console.error(JSON.stringify({ event: 'unhandled', error: error instanceof Error ? error.name : 'unknown' }));
      return withSecurityHeaders(plain(500, 'Internal error'), url);
    }
  },
} satisfies ExportedHandler<Env>;
