// The ONLY shape of data that may leave the owner's machine for the public mirror.
// Strict allow-list: unknown keys, wrong types, out-of-range values and strings that
// do not match their pattern are all rejected. Imported by the bridge, the relay Worker
// and (later) the public app, so it must stay dependency-free and runtime-neutral.

export const MAX_BOTS = 64;
export const MAX_SUBAGENTS = 8;
export const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Timestamps and run ages are coarse on purpose. */
export const TIME_GRAIN_MS = 10_000;

export const ISLANDS = ['auto', 'A', 'B', 'C', 'D', 'E', 'F', 'solo'] as const;
export type PublicIsland = (typeof ISLANDS)[number];
export type PublicFigure = 'male' | 'female';
export type PublicToolFamily = 'terminal' | 'web' | 'file' | 'mcp' | 'message' | 'other';

export type PublicActivity =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'tool'; family: PublicToolFamily }
  | { kind: 'waiting' }
  | { kind: 'meeting'; with: string[] };

export interface PublicBot {
  /** Opaque 16-char base32 id. */
  id: string;
  /** Owner-chosen public name. */
  name: string;
  color: string;
  figure: PublicFigure;
  island: PublicIsland;
  rank: number;
  activity: PublicActivity;
  subagents: number;
  /** Seconds since the current run started, rounded to 10 s; null when idle. */
  runStartedAgoSec: number | null;
}

export interface PublicSnapshot {
  v: 1;
  /** Milliseconds since the epoch, rounded to 10 s. */
  at: number;
  bots: PublicBot[];
}

export interface PublicEvent {
  kind: 'mail' | 'reply' | 'failed';
  /** Opaque bot id. */
  bot: string;
}

/**
 * Everything that travels toward viewers. A relay sends `viewers` to its viewers; a publisher that runs several relays
 * sends `viewers` to each of them (the total across all relays), and the relay decides when to show it.
 */
export type WireMessage =
  | { t: 'snapshot'; snapshot: PublicSnapshot }
  | { t: 'event'; event: PublicEvent }
  | { t: 'viewers'; n: number };

/** What a publisher may send to the relay: the same frames as viewers receive. */
export type PublisherMessage = WireMessage;

/** Relay-to-publisher control frame: the number of viewers connected to that relay alone. */
export interface RelayCountMessage {
  t: 'count';
  n: number;
}

export const MAX_VIEWER_COUNT = 100_000;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const OPAQUE_ID_PATTERN = /^[a-z2-7]{16}$/;
export const PUBLIC_NAME_PATTERN = /^[A-Za-z0-9 ._'-]{1,32}$/;
export const ISLAND_NAME_PATTERN = /^[A-Za-z0-9 ._'-]{1,18}$/;
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

const TOOL_FAMILIES: readonly string[] = ['terminal', 'web', 'file', 'mcp', 'message', 'other'];
const MAX_RUN_AGE_SEC = 7 * 24 * 3600;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Error text never echoes values, only field paths. */
function checkKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `${path}: unexpected key`;
  }
  for (const key of allowed) {
    if (!(key in value)) return `${path}.${key}: missing`;
  }
  return null;
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isMatch(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function validateActivity(value: unknown, path: string): Result<PublicActivity> {
  if (!isRecord(value)) return fail(`${path}: not an object`);
  switch (value.kind) {
    case 'idle':
    case 'thinking':
    case 'waiting': {
      const keyError = checkKeys(value, ['kind'], path);
      if (keyError !== null) return fail(keyError);
      return { ok: true, value: { kind: value.kind } };
    }
    case 'tool': {
      const keyError = checkKeys(value, ['kind', 'family'], path);
      if (keyError !== null) return fail(keyError);
      if (typeof value.family !== 'string' || !TOOL_FAMILIES.includes(value.family)) return fail(`${path}.family: invalid`);
      return { ok: true, value: { kind: 'tool', family: value.family as PublicToolFamily } };
    }
    case 'meeting': {
      const keyError = checkKeys(value, ['kind', 'with'], path);
      if (keyError !== null) return fail(keyError);
      const partners = value.with;
      if (!Array.isArray(partners) || partners.length > MAX_BOTS) return fail(`${path}.with: invalid`);
      const ids: string[] = [];
      for (const partner of partners) {
        if (!isMatch(partner, OPAQUE_ID_PATTERN)) return fail(`${path}.with: invalid id`);
        ids.push(partner);
      }
      return { ok: true, value: { kind: 'meeting', with: ids } };
    }
    default:
      return fail(`${path}.kind: invalid`);
  }
}

function validateBot(value: unknown, path: string): Result<PublicBot> {
  if (!isRecord(value)) return fail(`${path}: not an object`);
  const keyError = checkKeys(
    value,
    ['id', 'name', 'color', 'figure', 'island', 'rank', 'activity', 'subagents', 'runStartedAgoSec'],
    path,
  );
  if (keyError !== null) return fail(keyError);
  if (!isMatch(value.id, OPAQUE_ID_PATTERN)) return fail(`${path}.id: invalid`);
  if (!isMatch(value.name, PUBLIC_NAME_PATTERN) || value.name.trim().length === 0) return fail(`${path}.name: invalid`);
  if (!isMatch(value.color, COLOR_PATTERN)) return fail(`${path}.color: invalid`);
  if (value.figure !== 'male' && value.figure !== 'female') return fail(`${path}.figure: invalid`);
  if (typeof value.island !== 'string' || !(ISLANDS as readonly string[]).includes(value.island)) return fail(`${path}.island: invalid`);
  if (!isInt(value.rank, 0, MAX_BOTS - 1)) return fail(`${path}.rank: out of range`);
  if (!isInt(value.subagents, 0, MAX_SUBAGENTS)) return fail(`${path}.subagents: out of range`);
  const age = value.runStartedAgoSec;
  if (age !== null && (!isInt(age, 0, MAX_RUN_AGE_SEC) || age % 10 !== 0)) return fail(`${path}.runStartedAgoSec: invalid`);
  const activity = validateActivity(value.activity, `${path}.activity`);
  if (!activity.ok) return activity;
  return {
    ok: true,
    value: {
      id: value.id,
      name: value.name,
      color: value.color,
      figure: value.figure,
      island: value.island as PublicIsland,
      rank: value.rank,
      activity: activity.value,
      subagents: value.subagents,
      runStartedAgoSec: age,
    },
  };
}

export function validatePublicSnapshot(value: unknown): Result<PublicSnapshot> {
  if (!isRecord(value)) return fail('snapshot: not an object');
  const keyError = checkKeys(value, ['v', 'at', 'bots'], 'snapshot');
  if (keyError !== null) return fail(keyError);
  if (value.v !== 1) return fail('snapshot.v: unsupported');
  if (!isInt(value.at, 0, Number.MAX_SAFE_INTEGER) || value.at % TIME_GRAIN_MS !== 0) return fail('snapshot.at: invalid');
  if (!Array.isArray(value.bots) || value.bots.length > MAX_BOTS) return fail('snapshot.bots: invalid');
  const bots: PublicBot[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.bots.entries()) {
    const bot = validateBot(raw, `snapshot.bots[${index}]`);
    if (!bot.ok) return bot;
    if (seen.has(bot.value.id)) return fail(`snapshot.bots[${index}].id: duplicate`);
    seen.add(bot.value.id);
    bots.push(bot.value);
  }
  return { ok: true, value: { v: 1, at: value.at, bots } };
}

export function validatePublicEvent(value: unknown): Result<PublicEvent> {
  if (!isRecord(value)) return fail('event: not an object');
  const keyError = checkKeys(value, ['kind', 'bot'], 'event');
  if (keyError !== null) return fail(keyError);
  if (value.kind !== 'mail' && value.kind !== 'reply' && value.kind !== 'failed') return fail('event.kind: invalid');
  if (!isMatch(value.bot, OPAQUE_ID_PATTERN)) return fail('event.bot: invalid');
  return { ok: true, value: { kind: value.kind, bot: value.bot } };
}

export function validateViewerCount(value: unknown): Result<number> {
  return isInt(value, 0, MAX_VIEWER_COUNT) ? { ok: true, value } : fail('viewers.n: out of range');
}

export function validateWireMessage(value: unknown): Result<WireMessage> {
  if (!isRecord(value)) return fail('message: not an object');
  if (value.t === 'snapshot') {
    const keyError = checkKeys(value, ['t', 'snapshot'], 'message');
    if (keyError !== null) return fail(keyError);
    const snapshot = validatePublicSnapshot(value.snapshot);
    return snapshot.ok ? { ok: true, value: { t: 'snapshot', snapshot: snapshot.value } } : snapshot;
  }
  if (value.t === 'event') {
    const keyError = checkKeys(value, ['t', 'event'], 'message');
    if (keyError !== null) return fail(keyError);
    const event = validatePublicEvent(value.event);
    return event.ok ? { ok: true, value: { t: 'event', event: event.value } } : event;
  }
  if (value.t === 'viewers') {
    const keyError = checkKeys(value, ['t', 'n'], 'message');
    if (keyError !== null) return fail(keyError);
    const count = validateViewerCount(value.n);
    return count.ok ? { ok: true, value: { t: 'viewers', n: count.value } } : count;
  }
  return fail('message.t: invalid');
}

/** The frames a publisher may send; since multi-relay support these are all the viewer-facing frames. */
export function validatePublisherMessage(value: unknown): Result<PublisherMessage> {
  return validateWireMessage(value);
}

export function validateRelayCountMessage(value: unknown): Result<RelayCountMessage> {
  if (!isRecord(value) || value.t !== 'count') return fail('message.t: invalid');
  const keyError = checkKeys(value, ['t', 'n'], 'message');
  if (keyError !== null) return fail(keyError);
  const count = validateViewerCount(value.n);
  return count.ok ? { ok: true, value: { t: 'count', n: count.value } } : count;
}

function parseJson(text: string): Result<unknown> {
  // UTF-16 length is a lower bound on bytes/3 and an upper bound on bytes/1; check cheaply first.
  if (text.length > MAX_PAYLOAD_BYTES) return fail('message: too large');
  if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) return fail('message: too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('message: not JSON');
  }
  return { ok: true, value: parsed };
}

/** Size-checks then parses and validates one wire frame. */
export function parseWireMessage(text: string): Result<WireMessage> {
  const json = parseJson(text);
  return json.ok ? validateWireMessage(json.value) : json;
}

/** Size-checks then parses one frame received from a publisher. */
export function parsePublisherMessage(text: string): Result<PublisherMessage> {
  const json = parseJson(text);
  return json.ok ? validatePublisherMessage(json.value) : json;
}

/** Size-checks then parses one control frame a relay sent to its publisher. */
export function parseRelayCountMessage(text: string): Result<RelayCountMessage> {
  const json = parseJson(text);
  return json.ok ? validateRelayCountMessage(json.value) : json;
}

export function encodeRelayCountMessage(n: number): Result<string> {
  const checked = validateRelayCountMessage({ t: 'count', n });
  return checked.ok ? { ok: true, value: JSON.stringify(checked.value) } : checked;
}

/** Serialises a validated message; refuses oversized output. */
export function encodeWireMessage(message: WireMessage): Result<string> {
  const checked = validateWireMessage(message);
  if (!checked.ok) return checked;
  const text = JSON.stringify(checked.value);
  if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) return fail('message: too large');
  return { ok: true, value: text };
}
