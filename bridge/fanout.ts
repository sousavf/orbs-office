// Fan-out over several relays: snapshots and events go to every connected relay, and the viewer counts the relays
// report are summed into one total that is sent back to all of them. A relay that is down never blocks the others.

import { parseRelayCountMessage } from '../shared/public-snapshot';
import type { WireMessage } from '../shared/public-snapshot';
import type { ViewerSample } from './metrics';

/** One connection to one relay (see publisher.ts). */
export interface RelayLink {
  readonly name: string;
  readonly isConnected: boolean;
  onConnect: (() => void) | null;
  onDisconnect: (() => void) | null;
  /** A text frame from the relay (`pong` is filtered out before this). */
  onMessage: ((text: string) => void) | null;
  send(message: WireMessage): void;
  stop(): void;
}

export interface Fanout {
  /** Called when a relay (re)connects, so the caller can give it the current snapshot. */
  onRelayConnect: ((name: string) => void) | null;
  /** Called after the counts or the set of connected relays changed. */
  onChange: (() => void) | null;
  readonly anyConnected: boolean;
  /** To every connected relay. */
  send(message: WireMessage): void;
  /** To one relay. */
  sendTo(name: string, message: WireMessage): void;
  /** The sum of the latest viewer counts of the connected relays. */
  total(): number;
  /** The total, each relay's latest count (0 when down) and the connected relays, for the metrics log. */
  sample(): ViewerSample;
  /** Re-sends the total to every relay, so relays keep treating it as fresh. */
  refreshTotal(): void;
  stop(): void;
}

export function createFanout(links: readonly RelayLink[], log: (line: string) => void): Fanout {
  /** Latest viewer count per connected relay. A relay that is down or has not reported yet is absent. */
  const counts = new Map<string, number>();
  let lastTotal = -1;

  const total = (): number => [...counts.values()].reduce((sum, n) => sum + n, 0);
  const totalMessage = (): WireMessage => ({ t: 'viewers', n: total() });

  const sendAll = (message: WireMessage): void => {
    for (const link of links) if (link.isConnected) link.send(message);
  };

  /** Sends the total to everyone when it changed, else only to the relay that just reported. */
  const publishTotal = (reporter: RelayLink | null): void => {
    const next = total();
    if (next !== lastTotal) {
      lastTotal = next;
      sendAll(totalMessage());
    } else if (reporter?.isConnected === true) {
      reporter.send(totalMessage());
    }
  };

  const fanout: Fanout = {
    onRelayConnect: null,
    onChange: null,
    get anyConnected() {
      return links.some((link) => link.isConnected);
    },
    send: sendAll,
    sendTo(name, message) {
      const link = links.find((candidate) => candidate.name === name);
      if (link?.isConnected === true) link.send(message);
    },
    total,
    sample: () => ({
      total: total(),
      relays: Object.fromEntries(links.map((link) => [link.name, counts.get(link.name) ?? 0])),
      connected: links.filter((link) => link.isConnected).map((link) => link.name),
    }),
    refreshTotal() {
      if (counts.size === 0) return;
      lastTotal = total();
      sendAll(totalMessage());
    },
    stop() {
      for (const link of links) link.stop();
    },
  };

  for (const link of links) {
    link.onConnect = () => {
      counts.delete(link.name);
      fanout.onRelayConnect?.(link.name);
      // Until this relay reports its own count it still shows the others' total.
      if (counts.size > 0) link.send(totalMessage());
      fanout.onChange?.();
    };
    link.onDisconnect = () => {
      const hadCount = counts.delete(link.name);
      if (hadCount) publishTotal(null);
      fanout.onChange?.();
    };
    link.onMessage = (text) => {
      const parsed = parseRelayCountMessage(text);
      if (!parsed.ok) return;
      counts.set(link.name, parsed.value.n);
      publishTotal(link);
      fanout.onChange?.();
    };
  }
  if (links.length > 1) log(`publishing to ${links.length} relays: ${links.map((link) => link.name).join(', ')}`);
  return fanout;
}
