import { type Connect, defineConfig, type Plugin } from 'vite';
import { MAX_SETTINGS_BYTES, parseOfficeSettings } from './shared/office-settings';
import { readSettings, writeSettings } from './shared/settings-file';

const SETTINGS_ROUTE = '/office-settings';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const AVATAR_ROUTE = '/avatar-relay';
const BOT_ID = /^[\da-f-]{36}$/i;
const MAX_AVATAR_BYTES = 1024 * 1024;
const RELAY_TIMEOUT_MS = 5_000;

type IncomingMessage = Connect.IncomingMessage;
type ServerResponse = Parameters<Connect.NextHandleFunction>[1];

function reject(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.end();
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? '')) return false;
  // The Host and Origin checks also stop DNS-rebinding pages from reaching the file.
  const host = URL.parse(`http://${request.headers.host ?? ''}`)?.hostname ?? '';
  if (!LOOPBACK_HOSTS.has(host) && host !== '::1') return false;
  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    const originHost = URL.parse(origin)?.hostname ?? '';
    if (!LOOPBACK_HOSTS.has(originHost) && originHost !== '::1') return false;
  }
  return true;
}

function rejectWithMessage(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ error: message }));
}

/** True for localhost and loopback, RFC1918 and Tailscale (100.64.0.0/10) addresses; DNS names other than localhost are refused. */
function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = octets;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Reads the body but gives up as soon as it exceeds the cap, so an oversized response is never fully buffered. */
async function readCapped(upstream: Response, limit: number): Promise<Uint8Array | null> {
  if (upstream.body === null) return null;
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return all;
}

/**
 * The daemon serves rendered bot avatars without CORS headers, so WebGL cannot use them cross-origin.
 * This relays only `<daemon>/avatars/bots/<uuid>.png` through the app's own origin. The dev server listens
 * on the LAN, so the route serves loopback clients only and fetches only from private-network daemons.
 */
async function relayAvatar(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(request)) {
    reject(response, 403);
    return;
  }
  const query = new URL(request.originalUrl ?? '', 'http://relay.local').searchParams;
  const daemon = URL.parse(query.get('daemon') ?? '');
  const botId = query.get('bot') ?? '';
  if (daemon === null || !['http:', 'https:'].includes(daemon.protocol) || !BOT_ID.test(botId)) {
    reject(response, 400);
    return;
  }
  if (!isPrivateHost(daemon.hostname)) {
    reject(response, 403);
    return;
  }

  try {
    const upstream = await fetch(new URL(`/avatars/bots/${botId}.png`, daemon.origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    if (!upstream.ok || upstream.headers.get('content-type') !== 'image/png') {
      await upstream.body?.cancel();
      reject(response, 502);
      return;
    }
    const body = await readCapped(upstream, MAX_AVATAR_BYTES);
    if (body === null) {
      reject(response, 502);
      return;
    }
    response.setHeader('Content-Type', 'image/png');
    // The relay URL carries the avatar version, so a changed avatar gets a new URL.
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(body);
  } catch {
    reject(response, 502);
  }
}

function avatarRelay(): Plugin {
  const mount = (middlewares: Connect.Server): void => {
    middlewares.use(AVATAR_ROUTE, (req, res) => void relayAvatar(req, res));
  };
  return {
    name: 'orbs-avatar-relay',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  };
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    request.on('data', (chunk: Uint8Array) => {
      size += chunk.byteLength;
      if (size > MAX_SETTINGS_BYTES) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const all = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(new TextDecoder().decode(all));
    });
    request.on('error', () => resolve(null));
  });
}

async function handleSettings(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(request)) {
    reject(response, 403);
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (request.method === 'GET') {
      const current = readSettings();
      if (!current.ok) {
        rejectWithMessage(response, 500, 'The settings file is unreadable. Fix or remove it.');
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(current.value));
    } else if (request.method === 'PUT') {
      const body = await readBody(request);
      const parsed = body === null ? null : parseOfficeSettings(body);
      if (parsed === null || !parsed.ok) {
        reject(response, body === null ? 413 : 400);
        return;
      }
      if (!readSettings().ok) {
        rejectWithMessage(response, 409, 'The settings file is unreadable, so it was not replaced. Fix or remove it.');
        return;
      }
      writeSettings(parsed.value);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(parsed.value));
    } else {
      response.setHeader('Allow', 'GET, PUT');
      reject(response, 405);
    }
  } catch {
    reject(response, 500);
  }
}

/** Shared owner settings, backed by ~/.config/orbs-office/settings.json; loopback clients only. */
function officeSettings(): Plugin {
  const mount = (middlewares: Connect.Server): void => {
    middlewares.use(SETTINGS_ROUTE, (req, res) => void handleSettings(req, res));
  };
  return {
    name: 'orbs-office-settings',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  };
}

export default defineConfig({
  plugins: [avatarRelay(), officeSettings()],
  server: { host: true, port: 5190, strictPort: true },
  build: { chunkSizeWarningLimit: 2000 },
});
