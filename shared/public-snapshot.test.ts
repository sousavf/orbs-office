import { describe, expect, test } from 'bun:test';
import { emptySettings, validateOfficeSettings } from './office-settings';
import {
  MAX_PAYLOAD_BYTES,
  encodeRelayCountMessage,
  encodeWireMessage,
  parseRelayCountMessage,
  parsePublisherMessage,
  parseWireMessage,
  validatePublicEvent,
  validatePublicSnapshot,
} from './public-snapshot';

const BOT = {
  id: 'abcdefghijklmnop'.replace(/[ijklmnop]/g, 'a'),
  name: 'Agent 01',
  color: '#3b93f0',
  figure: 'male',
  island: 'auto',
  rank: 0,
  activity: { kind: 'idle' },
  subagents: 0,
  runStartedAgoSec: null,
};
const snapshot = (bot: Record<string, unknown> = {}): unknown => ({ v: 1, at: 1_800_000_000_000, bots: [{ ...BOT, ...bot }] });

describe('validatePublicSnapshot', () => {
  test('accepts a valid snapshot', () => {
    expect(validatePublicSnapshot(snapshot()).ok).toBe(true);
  });

  test('rejects unknown keys at every level', () => {
    expect(validatePublicSnapshot({ ...(snapshot() as object), extra: 1 }).ok).toBe(false);
    expect(validatePublicSnapshot(snapshot({ handle: 'x' })).ok).toBe(false);
    expect(validatePublicSnapshot(snapshot({ activity: { kind: 'idle', note: 'x' } })).ok).toBe(false);
    expect(validatePublicSnapshot(snapshot({ activity: { kind: 'tool', family: 'file', tool: 'Read' } })).ok).toBe(false);
  });

  test('rejects bad strings and ranges', () => {
    for (const bad of [
      { id: 'SHORT' }, { id: 'ABCDEFGHIJKLMNOP' }, { name: '' }, { name: 'a'.repeat(33) }, { name: '<script>' },
      { name: 'émile' }, { color: 'red' }, { color: '#FFFFFF' }, { figure: 'other' }, { island: 'G' }, { rank: 64 },
      { rank: 1.5 }, { subagents: 9 }, { subagents: -1 }, { runStartedAgoSec: 15 }, { runStartedAgoSec: -10 },
      { activity: { kind: 'tool', family: 'bash' } }, { activity: { kind: 'meeting', with: ['not-an-id'] } },
    ]) {
      expect(validatePublicSnapshot(snapshot(bad)).ok).toBe(false);
    }
  });

  test('rejects fine-grained timestamps, bad versions, too many and duplicate bots', () => {
    expect(validatePublicSnapshot({ v: 1, at: 1_800_000_000_001, bots: [] }).ok).toBe(false);
    expect(validatePublicSnapshot({ v: 2, at: 0, bots: [] }).ok).toBe(false);
    const letters = 'abcdefgh';
    const many = Array.from({ length: 65 }, (_, i) => ({ ...BOT, id: `${'a'.repeat(13)}${letters[(i >> 6) & 7]}${letters[(i >> 3) & 7]}${letters[i & 7]}`, rank: 0 }));
    expect(validatePublicSnapshot({ v: 1, at: 0, bots: many }).ok).toBe(false);
    expect(validatePublicSnapshot({ v: 1, at: 0, bots: [BOT, BOT] }).ok).toBe(false);
  });
});

describe('validatePublicEvent and wire parsing', () => {
  test('events carry only kind and an opaque id', () => {
    expect(validatePublicEvent({ kind: 'mail', bot: BOT.id }).ok).toBe(true);
    expect(validatePublicEvent({ kind: 'mail', bot: BOT.id, text: 'hi' }).ok).toBe(false);
    expect(validatePublicEvent({ kind: 'other', bot: BOT.id }).ok).toBe(false);
  });

  test('oversized and non-JSON frames are rejected', () => {
    expect(parseWireMessage('x'.repeat(MAX_PAYLOAD_BYTES + 1)).ok).toBe(false);
    expect(parseWireMessage('not json').ok).toBe(false);
    expect(parseWireMessage(JSON.stringify({ t: 'snapshot', snapshot: snapshot() })).ok).toBe(true);
    expect(parseWireMessage(JSON.stringify({ t: 'nope' })).ok).toBe(false);
  });
});

describe('viewers frame', () => {
  test('round-trips integers within range', () => {
    for (const n of [0, 1, 12, 100_000]) {
      const encoded = encodeWireMessage({ t: 'viewers', n });
      expect(encoded.ok).toBe(true);
      if (encoded.ok) expect(parseWireMessage(encoded.value)).toEqual({ ok: true, value: { t: 'viewers', n } });
    }
  });
  test('rejects bad counts and extra keys', () => {
    for (const bad of [-1, 100_001, 1.5, '3', null, Number.NaN]) {
      expect(parseWireMessage(JSON.stringify({ t: 'viewers', n: bad })).ok).toBe(false);
    }
    expect(parseWireMessage('{"t":"viewers"}').ok).toBe(false);
    expect(parseWireMessage('{"t":"viewers","n":1,"ip":"x"}').ok).toBe(false);
  });
  test('a publisher may send the cross-relay total, snapshots and events', () => {
    expect(parsePublisherMessage('{"t":"viewers","n":5}').ok).toBe(true);
    expect(parsePublisherMessage('{"t":"viewers","n":-5}').ok).toBe(false);
    expect(parsePublisherMessage('{"t":"count","n":5}').ok).toBe(false);
    expect(parsePublisherMessage(JSON.stringify({ t: 'event', event: { kind: 'mail', bot: 'abcdefghijklmnop' } })).ok).toBe(true);
    expect(parsePublisherMessage(JSON.stringify({ t: 'snapshot', snapshot: { v: 1, at: 0, bots: [] } })).ok).toBe(true);
  });
});

describe('relay count frame', () => {
  test('round-trips and rejects bad counts and extra keys', () => {
    const encoded = encodeRelayCountMessage(7);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(parseRelayCountMessage(encoded.value)).toEqual({ ok: true, value: { t: 'count', n: 7 } });
    for (const bad of ['{"t":"count"}', '{"t":"count","n":-1}', '{"t":"count","n":1.5}', '{"t":"count","n":1,"x":1}', '{"t":"viewers","n":1}', 'nope']) {
      expect(parseRelayCountMessage(bad).ok).toBe(false);
    }
    expect(encodeRelayCountMessage(100_001).ok).toBe(false);
  });
  test('viewers never accept a count frame', () => {
    expect(parseWireMessage('{"t":"count","n":1}').ok).toBe(false);
  });
});

describe('validateOfficeSettings', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  test('accepts valid and empty settings', () => {
    expect(validateOfficeSettings(emptySettings()).ok).toBe(true);
    expect(validateOfficeSettings({ figures: { [ID]: 'female' }, islands: { [ID]: 'B' }, publicNames: { [ID]: 'Ada' } }).ok).toBe(true);
  });
  test('rejects unknown keys, non-uuid ids and bad names', () => {
    expect(validateOfficeSettings({ ...emptySettings(), secret: 1 }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), figures: { nope: 'male' } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), publicNames: { [ID]: '<b>' } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), islands: { [ID]: 'Z' } }).ok).toBe(false);
  });
  test('accepts the solo island', () => {
    expect(validateOfficeSettings({ ...emptySettings(), islands: { [ID]: 'solo' } }).ok).toBe(true);
    expect(validatePublicSnapshot(snapshot({ island: 'solo' })).ok).toBe(true);
  });
  test('validates island names and working hours', () => {
    const hours = { enabled: true, days: [1, 2, 3], start: '07:00', end: '19:00', lunchStart: '12:30', lunchEnd: '14:00' };
    expect(validateOfficeSettings({ ...emptySettings(), islandNames: { A: 'Research', F: "Ops' desk" }, workingHours: hours }).ok).toBe(true);
    expect(validateOfficeSettings({ ...emptySettings(), islandNames: { G: 'Nope' } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), islandNames: { A: 'x'.repeat(19) } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), islandNames: { A: '<b>' } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), workingHours: { ...hours, start: '7:00' } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), workingHours: { ...hours, end: '06:00' } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), workingHours: { ...hours, lunchEnd: '20:00' } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), workingHours: { ...hours, days: [1, 1] } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), workingHours: { ...hours, days: [7] } }).ok).toBe(false);
    expect(validateOfficeSettings({ ...emptySettings(), workingHours: { ...hours, extra: 1 } }).ok).toBe(false);
  });
});
