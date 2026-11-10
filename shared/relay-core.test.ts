import { describe, expect, test } from 'bun:test';
import { BUSY_CLOSE_CODE, DEFAULT_RELAY_LIMITS, createCoalescer, createRelayCore } from './relay-core';
import type { RelayCore } from './relay-core';

const BOT = {
  id: 'aaaaaaaaaaaaaaaa',
  name: 'Agent 01',
  color: '#3b93f0',
  figure: 'male',
  island: 'auto',
  rank: 0,
  activity: { kind: 'idle' },
  subagents: 0,
  runStartedAgoSec: null,
};
const snapshotFrame = (at = 10_000, bots: unknown[] = [BOT]): string => JSON.stringify({ t: 'snapshot', snapshot: { v: 1, at, bots } });
const viewersFrame = (n: number): string => JSON.stringify({ t: 'viewers', n });

function setup(): { core: RelayCore; clock: { now: number } } {
  const clock = { now: 1_000_000 };
  return { core: createRelayCore({ now: () => clock.now }), clock };
}

describe('coalescer', () => {
  test('sends the first change at once, then at most once per interval', () => {
    const coalescer = createCoalescer(3000);
    expect(coalescer.step(1, 0)).toEqual({ send: true, dueAt: null });
    expect(coalescer.step(2, 1000)).toEqual({ send: false, dueAt: 3000 });
    expect(coalescer.step(2, 3000)).toEqual({ send: true, dueAt: null });
    expect(coalescer.step(2, 9000)).toEqual({ send: false, dueAt: null });
  });
  test('reset makes the next step send again', () => {
    const coalescer = createCoalescer(3000);
    coalescer.step(5, 0);
    coalescer.reset();
    expect(coalescer.step(5, 1)).toEqual({ send: true, dueAt: null });
  });
});

describe('viewer admission and abuse rule', () => {
  test('refuses beyond the total cap and the per-IP cap', () => {
    const { core } = setup();
    expect(core.admitViewer({ total: 999, fromIp: 0 })).toBe('ok');
    expect(core.admitViewer({ total: DEFAULT_RELAY_LIMITS.maxViewers, fromIp: 0 })).toBe('busy');
    expect(core.admitViewer({ total: 3, fromIp: 4 })).toBe('ok');
    expect(core.admitViewer({ total: 3, fromIp: 5 })).toBe('busy');
    expect(BUSY_CLOSE_CODE).toBe(4429);
  });
  test('tolerates a few small frames, closes on a stream or a big frame', () => {
    const { core } = setup();
    let messages = 0;
    for (let i = 0; i < 10; i += 1) {
      const verdict = core.onViewerMessage(10, messages);
      expect(verdict.close).toBe(false);
      messages = verdict.messages;
    }
    expect(core.onViewerMessage(10, messages).close).toBe(true);
    expect(core.onViewerMessage(1025, 0).close).toBe(true);
  });
});

describe('publisher frames', () => {
  test('forwards a valid snapshot and serves it back', () => {
    const { core } = setup();
    const result = core.onPublisherFrame(snapshotFrame());
    expect(result.forward).toBe(snapshotFrame());
    expect(JSON.parse(core.snapshotBody()).bots).toHaveLength(1);
    expect(core.hello(2)[0]).toBe(snapshotFrame());
  });
  test('rejects oversized, binary, malformed and unknown frames without forwarding', () => {
    const { core } = setup();
    for (const frame of ['x'.repeat(70_000), new ArrayBuffer(8), 'nope', '{"t":"event","event":{"kind":"mail","bot":"x"}}']) {
      const result = core.onPublisherFrame(frame);
      expect(result.forward).toBeNull();
      expect(result.invalid === null).toBe(false);
    }
  });
  test('an invalid streak closes the publisher; a valid frame resets it', () => {
    const { core, clock } = setup();
    for (let i = 0; i < 19; i += 1) {
      clock.now += 1000;
      expect(core.onPublisherFrame('bad').close).toBeNull();
    }
    clock.now += 1000;
    expect(core.onPublisherFrame(snapshotFrame()).close).toBeNull();
    for (let i = 0; i < 19; i += 1) {
      clock.now += 1000;
      core.onPublisherFrame('bad');
    }
    clock.now += 1000;
    expect(core.onPublisherFrame('bad').close).toEqual({ code: 1008, reason: 'too many invalid messages' });
  });
  test('the publish rate limit drops frames unparsed, then recovers next window', () => {
    const { core, clock } = setup();
    let forwarded = 0;
    for (let i = 0; i < 30; i += 1) if (core.onPublisherFrame(snapshotFrame(10_000 * (i + 1))).forward !== null) forwarded += 1;
    expect(forwarded).toBe(20);
    clock.now += 1000;
    expect(core.onPublisherFrame(snapshotFrame()).forward === null).toBe(false);
  });
  test('keepalive snapshots with the same bots are not persisted', () => {
    const { core, clock } = setup();
    core.onPublisherFrame(snapshotFrame(10_000));
    expect(core.tick({ localViewers: 0, publisherConnected: true }).persist).toBe(snapshotFrame(10_000));
    clock.now += 2000;
    core.onPublisherFrame(snapshotFrame(20_000));
    clock.now += 120_000;
    expect(core.tick({ localViewers: 0, publisherConnected: true }).persist).toBeNull();
  });
  test('persistence is throttled to once per interval and reports when it is due', () => {
    const { core, clock } = setup();
    core.onPublisherFrame(snapshotFrame(10_000));
    expect(core.tick({ localViewers: 0, publisherConnected: false }).persist).not.toBe(null);
    clock.now += 5000;
    core.onPublisherFrame(snapshotFrame(20_000, [{ ...BOT, name: 'Other' }]));
    const early = core.tick({ localViewers: 0, publisherConnected: false });
    expect(early.persist).toBeNull();
    expect(early.nextDueAt).toBe(clock.now - 5000 + 60_000);
    clock.now += 60_000;
    expect(core.tick({ localViewers: 0, publisherConnected: false }).persist).not.toBe(null);
  });
  test('flushPersist hands over a pending write immediately', () => {
    const { core } = setup();
    core.onPublisherFrame(snapshotFrame());
    expect(core.flushPersist()).toBe(snapshotFrame());
    expect(core.flushPersist()).toBeNull();
  });
  test('restore loads a stored snapshot and ignores garbage', () => {
    const { core } = setup();
    core.restore('garbage');
    expect(JSON.parse(core.snapshotBody()).bots).toHaveLength(0);
    core.restore(snapshotFrame(30_000));
    expect(JSON.parse(core.snapshotBody()).at).toBe(30_000);
    core.restore(viewersFrame(3));
    expect(JSON.parse(core.snapshotBody()).at).toBe(30_000);
  });
});

describe('viewer count', () => {
  test('shows the local count when no total was provided', () => {
    const { core } = setup();
    expect(core.displayedViewers(4)).toBe(4);
    expect(JSON.parse(core.viewersBody(4))).toEqual({ n: 4 });
    expect(core.hello(4)[1]).toBe(viewersFrame(4));
  });
  test('the publisher total replaces the local count while fresh and expires after 30 s', () => {
    const { core, clock } = setup();
    core.onPublisherFrame(viewersFrame(17));
    expect(core.displayedViewers(2)).toBe(17);
    expect(JSON.parse(core.stateBody(2)).viewers).toBe(17);
    clock.now += 29_999;
    expect(core.displayedViewers(2)).toBe(17);
    clock.now += 1;
    expect(core.displayedViewers(2)).toBe(2);
  });
  test('the publisher leaving drops the total at once', () => {
    const { core } = setup();
    core.onPublisherFrame(viewersFrame(17));
    core.onPublisherGone();
    expect(core.displayedViewers(2)).toBe(2);
  });
  test('a total frame is never forwarded to viewers as is', () => {
    const { core } = setup();
    expect(core.onPublisherFrame(viewersFrame(9)).forward).toBeNull();
  });
  test('broadcasts are coalesced to one per 3 s with a trailing send', () => {
    const { core, clock } = setup();
    expect(core.tick({ localViewers: 1, publisherConnected: false }).viewersFrame).toBe(viewersFrame(1));
    clock.now += 500;
    const waiting = core.tick({ localViewers: 2, publisherConnected: false });
    expect(waiting.viewersFrame).toBeNull();
    expect(waiting.nextDueAt).toBe(clock.now - 500 + 3000);
    clock.now += 2500;
    expect(core.tick({ localViewers: 3, publisherConnected: false }).viewersFrame).toBe(viewersFrame(3));
  });
  test('an expiring total switches viewers back to the local count and asks to be called at the expiry', () => {
    const { core, clock } = setup();
    core.tick({ localViewers: 2, publisherConnected: true });
    core.onPublisherFrame(viewersFrame(10));
    const shown = core.tick({ localViewers: 2, publisherConnected: true });
    expect(shown.nextDueAt).not.toBe(null);
    clock.now += 3000;
    expect(core.tick({ localViewers: 2, publisherConnected: true }).viewersFrame).toBe(viewersFrame(10));
    clock.now += 30_000;
    expect(core.tick({ localViewers: 2, publisherConnected: true }).viewersFrame).toBe(viewersFrame(2));
  });
  test('the relay reports its own count to the publisher, coalesced, and again on a new publisher', () => {
    const { core, clock } = setup();
    expect(core.tick({ localViewers: 3, publisherConnected: false }).countFrame).toBeNull();
    expect(core.tick({ localViewers: 3, publisherConnected: true }).countFrame).toBe('{"t":"count","n":3}');
    expect(core.tick({ localViewers: 3, publisherConnected: true }).countFrame).toBeNull();
    clock.now += 100;
    expect(core.tick({ localViewers: 4, publisherConnected: true }).countFrame).toBeNull();
    clock.now += 3000;
    expect(core.tick({ localViewers: 4, publisherConnected: true }).countFrame).toBe('{"t":"count","n":4}');
    core.onPublisherConnected();
    expect(core.tick({ localViewers: 4, publisherConnected: true }).countFrame).toBe('{"t":"count","n":4}');
  });
  test('the reported count is the local one even while a total is shown', () => {
    const { core } = setup();
    core.onPublisherFrame(viewersFrame(40));
    expect(core.tick({ localViewers: 5, publisherConnected: true }).countFrame).toBe('{"t":"count","n":5}');
  });
});
