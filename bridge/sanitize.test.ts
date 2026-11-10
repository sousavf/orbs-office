import { describe, expect, test } from 'bun:test';
import type { BotState, OfficeEvent, OfficeState } from '../src/feed/office.types';
import { emptySettings } from '../shared/office-settings';
import { validatePublicEvent, validatePublicSnapshot } from '../shared/public-snapshot';
import { opaqueId, sanitizeEvent, sanitizeState } from './sanitize';

const CANARIES = [
  'CANARY_NAME', 'CANARY_HANDLE', 'CANARY_TOOL', 'CANARY_PREVIEW', 'CANARY_TITLE', 'CANARY_ROUTINE',
  'CANARY_INPUT', 'CANARY_SUBAGENT', 'CANARY_AVATAR', 'CANARY_SERVER', 'CANARY_RUNID', 'CANARY_TOKEN',
];
const SECRET = new Uint8Array(32).fill(7);
const NOW = 1_800_000_123_456;
const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function bot(id: string, rank: number, overrides: Partial<BotState> = {}): BotState {
  return {
    id,
    name: `CANARY_NAME_${rank}`,
    handle: `CANARY_HANDLE_${rank}`,
    avatar: { kind: 'image', src: 'https://CANARY_AVATAR.example/a.png' },
    color: '#3b93f0',
    rank,
    activity: { kind: 'tool', tool: 'CANARY_TOOL_bash', family: 'terminal' },
    run: {
      id: 'CANARY_RUNID',
      trigger: 'message',
      title: 'CANARY_TITLE',
      startedAt: NOW - 95_000,
      toolCallCount: 1234,
      tokens: 987654,
      isFailed: false,
    },
    subagents: [{ id: 'CANARY_SUBAGENT', name: 'CANARY_SUBAGENT', activity: { kind: 'thinking' } }],
    nextRoutine: { name: 'CANARY_ROUTINE', at: NOW + 3_600_000 },
    lastMessage: { role: 'assistant', preview: 'CANARY_PREVIEW', createdAt: NOW },
    ...overrides,
  };
}

function state(bots: BotState[]): OfficeState {
  return {
    connection: { kind: 'connected', serverUrl: 'http://CANARY_SERVER:47191' },
    bots: new Map(bots.map((b) => [b.id, b])),
  };
}

function privateState(): OfficeState {
  return state([
    bot(ID_A, 0, { activity: { kind: 'meeting', withBotIds: [ID_B, 'CANARY_UNKNOWN_PARTNER'] } }),
    bot(ID_B, 1, { activity: { kind: 'waiting', approvalCount: 4242 } }),
    bot('cccccccc-0000-4000-8000-000000000003', 2, { run: null, subagents: [], activity: { kind: 'idle' } }),
  ]);
}

describe('sanitizeState leak canaries', () => {
  test('no canary appears anywhere in the serialized snapshot', () => {
    const snapshot = sanitizeState(privateState(), emptySettings(), SECRET, NOW);
    const text = JSON.stringify(snapshot);
    for (const canary of CANARIES) expect(text).not.toContain(canary);
    expect(text).not.toContain('CANARY');
    expect(text).not.toContain('4242');
    expect(text).not.toContain('987654');
    expect(text).not.toContain(ID_A);
    expect(text).not.toContain(ID_B);
  });

  test('output passes the strict validator and has coarse times', () => {
    const snapshot = sanitizeState(privateState(), emptySettings(), SECRET, NOW);
    expect(validatePublicSnapshot(snapshot).ok).toBe(true);
    expect(snapshot.at % 10_000).toBe(0);
    expect(snapshot.bots[0]?.runStartedAgoSec).toBe(90);
    expect(snapshot.bots[2]?.runStartedAgoSec).toBe(null);
  });

  test('missing public names fall back to zero-padded rank labels', () => {
    const snapshot = sanitizeState(privateState(), emptySettings(), SECRET, NOW);
    expect(snapshot.bots.map((b) => b.name)).toEqual(['Agent 01', 'Agent 02', 'Agent 03']);
  });

  test('owner public names, figures and islands are applied', () => {
    const settings = {
      ...emptySettings(),
      publicNames: { [ID_A]: "Ada O'Neil" },
      figures: { [ID_A]: 'female' as const },
      islands: { [ID_A]: 'C' as const },
    };
    const first = sanitizeState(privateState(), settings, SECRET, NOW).bots[0];
    expect(first?.name).toBe("Ada O'Neil");
    expect(first?.figure).toBe('female');
    expect(first?.island).toBe('C');
  });

  test('the solo island passes through to the public bot', () => {
    const settings = { ...emptySettings(), islands: { [ID_A]: 'solo' as const } };
    expect(sanitizeState(privateState(), settings, SECRET, NOW).bots[0]?.island).toBe('solo');
  });

  test('meeting partners map to opaque ids and unknown partners are dropped', () => {
    const first = sanitizeState(privateState(), emptySettings(), SECRET, NOW).bots[0];
    expect(first?.activity).toEqual({ kind: 'meeting', with: [opaqueId(SECRET, ID_B)] });
  });

  test('subagent count is capped and tool names never survive', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: null, activity: { kind: 'idle' as const } }));
    const snapshot = sanitizeState(state([bot(ID_A, 0, { subagents: many })]), emptySettings(), SECRET, NOW);
    expect(snapshot.bots[0]?.subagents).toBe(8);
    expect(JSON.stringify(snapshot)).not.toContain('bash');
  });

  test('a bad colour falls back to a safe default', () => {
    const snapshot = sanitizeState(state([bot(ID_A, 0, { color: 'CANARY_COLOR' })]), emptySettings(), SECRET, NOW);
    expect(snapshot.bots[0]?.color).toBe('#8a8f98');
  });

  test('more than 64 bots are truncated', () => {
    const bots = Array.from({ length: 80 }, (_, i) => bot(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, i));
    expect(sanitizeState(state(bots), emptySettings(), SECRET, NOW).bots.length).toBe(64);
  });
});

describe('sanitizeEvent', () => {
  test('keeps only the kind and an opaque id', () => {
    const events: OfficeEvent[] = [
      { kind: 'mail', botId: ID_A, trigger: 'routine' },
      { kind: 'reply', botId: ID_A, text: 'CANARY_PREVIEW' },
      { kind: 'failed', botId: ID_A },
    ];
    for (const event of events) {
      const result = sanitizeEvent(event, SECRET);
      expect(result).toEqual({ kind: event.kind, bot: opaqueId(SECRET, ID_A) });
      expect(validatePublicEvent(result).ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain('CANARY');
    }
  });

  test('state events produce nothing', () => {
    expect(sanitizeEvent({ kind: 'state', state: privateState() }, SECRET)).toBe(null);
  });
});

describe('opaque ids', () => {
  test('are stable per secret and differ across secrets', () => {
    const other = new Uint8Array(32).fill(9);
    expect(opaqueId(SECRET, ID_A)).toBe(opaqueId(SECRET, ID_A));
    expect(opaqueId(SECRET, ID_A)).not.toBe(opaqueId(other, ID_A));
    expect(opaqueId(SECRET, ID_A)).not.toBe(opaqueId(SECRET, ID_B));
    expect(/^[a-z2-7]{16}$/.test(opaqueId(SECRET, ID_A))).toBe(true);
  });
});
