import { describe, expect, test } from 'bun:test';
import type { WireMessage } from '../shared/public-snapshot';
import { createFanout } from './fanout';
import type { RelayLink } from './fanout';

class FakeLink implements RelayLink {
  isConnected = false;
  onConnect: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;
  onMessage: ((text: string) => void) | null = null;
  sent: WireMessage[] = [];
  constructor(readonly name: string) {}
  send(message: WireMessage): void {
    this.sent.push(message);
  }
  stop(): void {}
  connect(): void {
    this.isConnected = true;
    this.onConnect?.();
  }
  drop(): void {
    this.isConnected = false;
    this.onDisconnect?.();
  }
  report(n: number): void {
    this.onMessage?.(JSON.stringify({ t: 'count', n }));
  }
  totals(): number[] {
    return this.sent.flatMap((message) => (message.t === 'viewers' ? [message.n] : []));
  }
}

const SNAPSHOT: WireMessage = { t: 'snapshot', snapshot: { v: 1, at: 0, bots: [] } };

function setup(count = 3): { links: FakeLink[]; fanout: ReturnType<typeof createFanout> } {
  const links = Array.from({ length: count }, (_, i) => new FakeLink(`r${i + 1}`));
  const fanout = createFanout(links, () => {});
  for (const link of links) link.connect();
  return { links, fanout };
}

describe('fan-out', () => {
  test('snapshots and events go to every connected relay and skip the ones that are down', () => {
    const { links, fanout } = setup();
    links[1]?.drop();
    fanout.send(SNAPSHOT);
    expect(links[0]?.sent).toEqual([SNAPSHOT]);
    expect(links[1]?.sent).toEqual([]);
    expect(links[2]?.sent).toEqual([SNAPSHOT]);
    expect(fanout.anyConnected).toBe(true);
  });

  test('sendTo reaches one relay only', () => {
    const { links, fanout } = setup();
    fanout.sendTo('r2', SNAPSHOT);
    expect(links.map((link) => link.sent.length)).toEqual([0, 1, 0]);
    links[1]?.drop();
    fanout.sendTo('r2', SNAPSHOT);
    expect(links[1]?.sent).toHaveLength(1);
  });

  test('the total is the sum of the latest counts, sent to all relays', () => {
    const { links, fanout } = setup();
    links[0]?.report(2);
    links[1]?.report(3);
    links[2]?.report(4);
    expect(fanout.total()).toBe(9);
    for (const link of links) expect(link.totals().at(-1)).toBe(9);
    links[1]?.report(0);
    for (const link of links) expect(link.totals().at(-1)).toBe(6);
  });

  test('an unchanged total goes back only to the relay that reported', () => {
    const { links } = setup();
    links[0]?.report(2);
    const before = links.map((link) => link.sent.length);
    links[0]?.report(2);
    expect(links.map((link) => link.sent.length)).toEqual([before[0] === undefined ? 0 : before[0] + 1, before[1] ?? 0, before[2] ?? 0]);
  });

  test('a relay going down leaves the sum and the others keep being told', () => {
    const { links, fanout } = setup();
    links[0]?.report(2);
    links[1]?.report(3);
    links[0]?.drop();
    expect(fanout.total()).toBe(3);
    expect(links[1]?.totals().at(-1)).toBe(3);
    expect(links[2]?.totals().at(-1)).toBe(3);
    expect(links[0]?.totals().at(-1)).toBe(5);
  });

  test('a relay that reconnects is given the current total and the snapshot hook', () => {
    const { links, fanout } = setup();
    const connected: string[] = [];
    fanout.onRelayConnect = (name) => connected.push(name);
    links[0]?.report(2);
    links[1]?.drop();
    links[1]?.connect();
    expect(connected).toEqual(['r2']);
    expect(links[1]?.totals().at(-1)).toBe(2);
  });

  test('refreshTotal re-sends to every connected relay, and stays silent before any count', () => {
    const { links, fanout } = setup();
    fanout.refreshTotal();
    expect(links.map((link) => link.sent.length)).toEqual([0, 0, 0]);
    links[0]?.report(1);
    const before = links.map((link) => link.sent.length);
    fanout.refreshTotal();
    links.forEach((link, i) => expect(link.sent.length).toBe((before[i] ?? 0) + 1));
  });

  test('malformed relay frames are ignored', () => {
    const { links, fanout } = setup();
    links[0]?.onMessage?.('hello');
    links[0]?.onMessage?.('{"t":"count","n":-1}');
    expect(fanout.total()).toBe(0);
  });

  test('no relay connected means nothing to publish', () => {
    const { links, fanout } = setup(2);
    for (const link of links) link.drop();
    expect(fanout.anyConnected).toBe(false);
    fanout.send(SNAPSHOT);
    expect(links[0]?.sent).toEqual([]);
  });
});
