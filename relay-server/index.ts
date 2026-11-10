// Standalone Orbs Office relay (Bun). Configuration is environment only; see docs/deploy-relay-server.md.
//   PUBLISH_TOKEN | PUBLISH_TOKEN_FILE   publisher bearer token (>= 32 chars)
//   HOST (127.0.0.1)  PORT (8790)  DATA_DIR (./data)
//   ALLOWED_ORIGINS   comma-separated page origins allowed to open /live and read the JSON endpoints
//   METRICS_TOKEN | METRICS_ALLOW_LOOPBACK=1   optional GET /metrics (Prometheus); off unless one is set
//   TRUST_PROXY       "cloudflare" when behind a Cloudflare Tunnel: client IP from CF-Connecting-IP

import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from './config';
import { startRelayServer } from './server';

/** One JSON object per line. Events carry counts and reasons only: never IP addresses, tokens or payloads. */
function log(event: string, fields: Record<string, string | number> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

const config = loadConfig(process.env, (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null));
if (!config.ok) {
  log('config_error', { error: config.error });
  process.exit(2);
}

const relay = startRelayServer(config.value, log);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void relay.stop().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
