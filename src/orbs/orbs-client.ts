import { createORPCClient } from '@orpc/client';
import type { Client, ClientContext } from '@orpc/client';
import { RetryLinkPlugin } from '@orpc/client/plugins';
import { RPCLink as WebSocketRPCLink } from '@orpc/client/websocket';
import { ORBS_PROTOCOL } from './orbs.types';
import type { OrbsClient, PairingRedeemResult } from './orbs.types';

const PAIRING_TIMEOUT_MS = 10_000;
const PIN_PATTERN = /^\d{6}$/;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export interface OrbsClientOptions {
  daemonUrl: string;
  token: string;
  serverId: string;
}

/** User-facing failure while pairing; `message` is safe to show as-is. */
export class PairingError extends Error {
  override readonly name = 'PairingError';
}

/** Returns the origin of an http(s) daemon URL without a trailing slash, or null when invalid. */
export function normalizeDaemonUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export interface OrbsConnection {
  client: OrbsClient;
  /** Closes the WebSocket and stops it from reconnecting. */
  close(): void;
}

export function makeOrbsClient({ daemonUrl, token, serverId }: OrbsClientOptions): OrbsConnection {
  const origin = normalizeDaemonUrl(daemonUrl);
  if (origin === null) throw new PairingError('The daemon URL is not a valid http or https address.');

  const wsUrl = new URL(ORBS_PROTOCOL.rpcPath, origin.replace(/^http/, 'ws')).toString();

  const retry = new RetryLinkPlugin({
    default: {
      retry: ({ path }) => (path[0] === 'conversation' && path[1] === 'watchList' ? Number.POSITIVE_INFINITY : 0),
      shouldRetry: ({ error, signal }) => !signal?.aborted && error instanceof Error && error.name === 'AbortError',
    },
  });

  let socket: WebSocket | null = null;
  let isClosed = false;

  const link = new WebSocketRPCLink({
    connect: () => {
      if (isClosed) throw new Error('Orbs connection closed');
      socket = new WebSocket(wsUrl);
      return socket;
    },
    reconnect: { enabled: true },
    headers: () => ({
      [ORBS_PROTOCOL.versionHeader]: String(ORBS_PROTOCOL.version),
      [ORBS_PROTOCOL.serverIdHeader]: serverId,
      authorization: `Bearer ${token}`,
    }),
    plugins: [retry],
  });

  // The oRPC client is untyped at runtime; OrbsClient is the hand-written contract subset.
  const client = createORPCClient(link) as unknown as OrbsClient;
  return {
    client,
    close() {
      isClosed = true;
      socket?.close();
      socket = null;
    },
  };
}

type PairingClient = {
  pairing: { redeem: Client<ClientContext, { pin: string; name: string }, unknown, Error> };
};

export async function redeemPairing(daemonUrl: string, pin: string, deviceName = 'Orbs Office'): Promise<PairingRedeemResult> {
  const origin = normalizeDaemonUrl(daemonUrl);
  if (origin === null) throw new PairingError('Enter a valid http or https daemon URL.');
  const cleanPin = pin.trim();
  if (!PIN_PATTERN.test(cleanPin)) throw new PairingError('The PIN must be exactly 6 digits.');

  // Pairing goes over a WebSocket too: the daemon's CORS allow-list usually omits this app's origin,
  // while its WebSocket origin check accepts localhost and IP addresses.
  const socket = new WebSocket(new URL(ORBS_PROTOCOL.rpcPath, origin.replace(/^http/, 'ws')).toString());
  const link = new WebSocketRPCLink({
    connect: () => socket,
    headers: () => ({ [ORBS_PROTOCOL.versionHeader]: String(ORBS_PROTOCOL.version) }),
  });
  const client = createORPCClient<PairingClient>(link);

  let raw: unknown;
  try {
    raw = await client.pairing.redeem(
      { pin: cleanPin, name: deviceName },
      { signal: AbortSignal.timeout(PAIRING_TIMEOUT_MS) },
    );
  } catch (error) {
    throw new PairingError(pairingFailureMessage(error));
  } finally {
    socket.close();
  }

  const result = parseRedeemResult(raw);
  if (result === null) throw new PairingError('The daemon returned an unexpected pairing response.');
  return result;
}

function pairingFailureMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 'PROTOCOL_MISMATCH') return 'This Orbs daemon speaks a different protocol version.';
  if (code !== null && code !== 'INTERNAL_SERVER_ERROR') return 'The PIN was rejected. It may be wrong or expired; request a new one.';
  return 'Could not reach the daemon. Check the URL and that Orbs is running.';
}

/** Reads the oRPC error code from an unknown thrown value. */
export function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRedeemResult(raw: unknown): PairingRedeemResult | null {
  if (!isRecord(raw)) return null;
  const { token, serverId, addresses } = raw;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  if (typeof serverId !== 'string' || serverId.length === 0) return null;
  if (!Array.isArray(addresses)) return null;

  const parsed: PairingRedeemResult['addresses'] = [];
  for (const address of addresses) {
    if (!isRecord(address) || typeof address.url !== 'string') return null;
    parsed.push({ url: address.url });
  }
  return { token, serverId, addresses: parsed };
}
