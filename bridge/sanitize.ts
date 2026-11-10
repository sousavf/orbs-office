// Turns the private OfficeState into the public allow-list. This is the single place
// where data crosses from "company private" to "public": every field of the output is
// built explicitly from a small set of inputs; nothing is copied wholesale.

import { createHmac } from 'node:crypto';
import type { BotActivity, BotState, OfficeEvent, OfficeState } from '../src/feed/office.types';
import type { OfficeSettings } from '../shared/office-settings';
import { COLOR_PATTERN, MAX_BOTS, MAX_SUBAGENTS, TIME_GRAIN_MS } from '../shared/public-snapshot';
import type { PublicActivity, PublicBot, PublicEvent, PublicSnapshot } from '../shared/public-snapshot';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const FALLBACK_COLOR = '#8a8f98';
const RUN_AGE_GRAIN_SEC = TIME_GRAIN_MS / 1000;

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Stable per secret, unlinkable to the real bot id without it. */
export function opaqueId(secret: Uint8Array, botId: string): string {
  return base32(createHmac('sha256', secret).update(botId).digest()).slice(0, 16);
}

function publicActivity(
  activity: BotActivity,
  ids: ReadonlyMap<string, string>,
): PublicActivity {
  switch (activity.kind) {
    case 'idle':
      return { kind: 'idle' };
    case 'thinking':
      return { kind: 'thinking' };
    case 'waiting':
      return { kind: 'waiting' };
    case 'tool':
      return { kind: 'tool', family: activity.family };
    case 'meeting': {
      const partners: string[] = [];
      for (const botId of activity.withBotIds) {
        const partner = ids.get(botId);
        if (partner !== undefined) partners.push(partner);
      }
      return partners.length === 0 ? { kind: 'thinking' } : { kind: 'meeting', with: partners };
    }
  }
}

function fallbackName(rank: number): string {
  return `Agent ${String(rank + 1).padStart(2, '0')}`;
}

function publicBot(
  bot: BotState,
  rank: number,
  id: string,
  ids: ReadonlyMap<string, string>,
  settings: OfficeSettings,
  nowMs: number,
): PublicBot {
  const runAgeSec = bot.run === null ? null : Math.max(0, Math.floor((nowMs - bot.run.startedAt) / 1000));
  return {
    id,
    name: settings.publicNames[bot.id] ?? fallbackName(rank),
    color: COLOR_PATTERN.test(bot.color) ? bot.color : FALLBACK_COLOR,
    figure: settings.figures[bot.id] ?? 'male',
    island: settings.islands[bot.id] ?? 'auto',
    rank,
    activity: publicActivity(bot.activity, ids),
    subagents: Math.min(bot.subagents.length, MAX_SUBAGENTS),
    runStartedAgoSec: runAgeSec === null ? null : Math.floor(runAgeSec / RUN_AGE_GRAIN_SEC) * RUN_AGE_GRAIN_SEC,
  };
}

export function sanitizeState(
  state: OfficeState,
  settings: OfficeSettings,
  secret: Uint8Array,
  nowMs: number,
): PublicSnapshot {
  const ordered = [...state.bots.values()].sort((a, b) => a.rank - b.rank).slice(0, MAX_BOTS);
  const ids = new Map(ordered.map((bot) => [bot.id, opaqueId(secret, bot.id)]));
  const bots = ordered.flatMap((bot, rank) => {
    const id = ids.get(bot.id);
    return id === undefined ? [] : [publicBot(bot, rank, id, ids, settings, nowMs)];
  });
  return { v: 1, at: Math.floor(nowMs / TIME_GRAIN_MS) * TIME_GRAIN_MS, bots };
}

/** Events carry the kind and an opaque id only: never trigger, text or preview. */
export function sanitizeEvent(event: OfficeEvent, secret: Uint8Array): PublicEvent | null {
  if (event.kind === 'state') return null;
  return { kind: event.kind, bot: opaqueId(secret, event.botId) };
}
