// Headers applied to every response the Worker returns (WebSocket upgrades excepted).
// The header set itself lives in shared/ so the standalone relay and the build-time `_headers` file use the same source.

import { securityHeaders } from '../../shared/security-headers';

export function withSecurityHeaders(response: Response, url: URL): Response {
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders([url.protocol === 'https:' ? `wss://${url.host}` : `ws://${url.host}`]))) secured.headers.set(name, value);
  return secured;
}
