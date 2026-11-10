// Environment parsing for the standalone relay. Pure: the caller passes the environment and a file reader.

import { parseOriginList } from '../shared/relay-http';
import type { Result } from '../shared/public-snapshot';

export interface RelayServerConfig {
  host: string;
  port: number;
  publishToken: string;
  allowedOrigins: string[];
  /** `cloudflare`: the client IP comes from CF-Connecting-IP (the server sits behind a Cloudflare Tunnel). */
  trustProxy: 'cloudflare' | null;
  dataDir: string;
  /** Bearer token for GET /metrics; null when not configured. */
  metricsToken: string | null;
  /** Let loopback and private-network peers without Cloudflare headers read GET /metrics. */
  metricsAllowLoopback: boolean;
}

const MIN_TOKEN_LENGTH = 32;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Error messages name the variable, never its value. */
export function loadConfig(
  env: Record<string, string | undefined>,
  readTextFile: (path: string) => string | null,
): Result<RelayServerConfig> {
  const fromEnv = env.PUBLISH_TOKEN?.trim() ?? '';
  const tokenFile = env.PUBLISH_TOKEN_FILE?.trim() ?? '';
  let publishToken = fromEnv;
  if (publishToken.length === 0 && tokenFile.length > 0) {
    const text = readTextFile(tokenFile);
    if (text === null) return fail('PUBLISH_TOKEN_FILE: cannot read the file');
    publishToken = text.trim();
  }
  if (publishToken.length < MIN_TOKEN_LENGTH) {
    return fail(`PUBLISH_TOKEN or PUBLISH_TOKEN_FILE: a token of at least ${MIN_TOKEN_LENGTH} characters is required`);
  }

  const portText = env.PORT?.trim() ?? '8790';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port > 65_535) return fail('PORT: not a valid port');

  const allowedOrigins = parseOriginList(env.ALLOWED_ORIGINS);
  if (allowedOrigins === null) return fail('ALLOWED_ORIGINS: expected comma-separated origins like https://office.example');

  const trust = env.TRUST_PROXY?.trim().toLowerCase() ?? '';
  if (trust !== '' && trust !== 'cloudflare') return fail('TRUST_PROXY: only "cloudflare" is supported');

  const metricsToken = env.METRICS_TOKEN?.trim() ?? '';
  if (metricsToken.length > 0 && metricsToken.length < MIN_TOKEN_LENGTH) {
    return fail(`METRICS_TOKEN: a token of at least ${MIN_TOKEN_LENGTH} characters is required`);
  }
  const loopback = env.METRICS_ALLOW_LOOPBACK?.trim() ?? '';
  if (loopback !== '' && loopback !== '0' && loopback !== '1') return fail('METRICS_ALLOW_LOOPBACK: expected 0 or 1');

  return {
    ok: true,
    value: {
      host: env.HOST?.trim() || '127.0.0.1',
      port,
      publishToken,
      allowedOrigins,
      trustProxy: trust === 'cloudflare' ? 'cloudflare' : null,
      dataDir: env.DATA_DIR?.trim() || './data',
      metricsToken: metricsToken.length > 0 ? metricsToken : null,
      metricsAllowLoopback: loopback === '1',
    },
  };
}
