import { describe, expect, test } from 'bun:test';
import type { BotActivity } from './office.types';
import { busyFallback, pairMeetings } from './office-feed.utils';
import type { MeetingCandidate } from './office-feed.utils';

function candidate(overrides: Partial<MeetingCandidate> & Pick<MeetingCandidate, 'botId'>): MeetingCandidate {
  return {
    name: overrides.botId,
    handle: `@${overrides.botId}`,
    family: null,
    inputs: [],
    hasLivePeerRun: false,
    privatePeers: [],
    peerRunTitle: null,
    ...overrides,
  };
}

describe('busyFallback', () => {
  test('returns thinking when the bot is idle but busy', () => {
    const result = busyFallback({ kind: 'idle' }, true);

    expect(result).toEqual({ kind: 'thinking' });
  });

  test('stays idle when the bot is idle and not busy', () => {
    const result = busyFallback({ kind: 'idle' }, false);

    expect(result).toEqual({ kind: 'idle' });
  });

  test('keeps a tool activity unchanged when busy', () => {
    const activity: BotActivity = { kind: 'tool', tool: 'bash', family: 'terminal' };

    const result = busyFallback(activity, true);

    expect(result).toBe(activity);
  });

  test('keeps a waiting activity unchanged when busy', () => {
    const activity: BotActivity = { kind: 'waiting', approvalCount: 2 };

    const result = busyFallback(activity, true);

    expect(result).toBe(activity);
  });
});

describe('pairMeetings', () => {
  test('links a messaging sender with its running private peer both ways', () => {
    const candidates = [
      candidate({ botId: 'a', family: 'message', privatePeers: ['b'] }),
      candidate({ botId: 'b' }),
    ];

    const meetings = pairMeetings(candidates);

    expect(meetings.get('a')).toEqual(['b']);
    expect(meetings.get('b')).toEqual(['a']);
  });

  test('links only the private peer named in the tool input', () => {
    const candidates = [
      candidate({ botId: 'a', family: 'message', privatePeers: ['b', 'c'], inputs: ['hello @c, ready?'] }),
      candidate({ botId: 'b' }),
      candidate({ botId: 'c' }),
    ];

    const meetings = pairMeetings(candidates);

    expect(meetings.get('a')).toEqual(['c']);
    expect(meetings.has('b')).toBe(false);
  });

  test('makes no meeting when several private peers exist and none is named', () => {
    const candidates = [
      candidate({ botId: 'a', family: 'message', privatePeers: ['b', 'c'], inputs: ['hello there'] }),
      candidate({ botId: 'b' }),
      candidate({ botId: 'c' }),
    ];

    const meetings = pairMeetings(candidates);

    expect(meetings.size).toBe(0);
  });

  test('ignores private peers while the sender is not messaging', () => {
    const candidates = [
      candidate({ botId: 'a', family: null, privatePeers: ['b'] }),
      candidate({ botId: 'b' }),
    ];

    const meetings = pairMeetings(candidates);

    expect(meetings.size).toBe(0);
  });

  test('still links a peer-run recipient with the sender named in its title', () => {
    const candidates = [
      candidate({ botId: 'alice-id', name: 'Alice' }),
      candidate({ botId: 'bob-id', name: 'Bob', hasLivePeerRun: true, peerRunTitle: '[Private message from Alice. hello' }),
    ];

    const meetings = pairMeetings(candidates);

    expect(meetings.get('bob-id')).toEqual(['alice-id']);
    expect(meetings.get('alice-id')).toEqual(['bob-id']);
  });
});
