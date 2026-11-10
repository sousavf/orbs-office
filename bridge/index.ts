// Orbs Office public-mirror bridge.
//   bun run bridge pair --daemon http://localhost:47191 --pin 123456
//   bun run bridge metrics [--since 7d] [--until ...] [--step 1h] [--format table|csv|json]   (read-only report)
//   bun run bridge [run] [--relay ws://localhost:8787/publish] [--relay wss://...] [--synthetic]
// Reads the private office state from the local daemon, reduces it to the public
// allow-list (bridge/sanitize.ts) and pushes it outbound to every relay. Several relays come from repeated --relay
// flags or ~/.config/orbs-office/relays.json; each gets its own connection. --synthetic publishes invented bots
// instead of reading the daemon (for testing relays).

import { statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { createOfficeFeed } from '../src/feed/office-feed';
import { normalizeDaemonUrl, redeemPairing } from '../src/orbs/orbs-client';
import type { OfficeState } from '../src/feed/office.types';
import { emptySettings } from '../shared/office-settings';
import { validatePublicEvent } from '../shared/public-snapshot';
import { validatePublicSnapshot } from '../shared/public-snapshot';
import type { PublicSnapshot } from '../shared/public-snapshot';
import type { Result } from '../shared/public-snapshot';
import { configDir, configPath, readPrivateFile, readSettings } from '../shared/settings-file';
import { fileGrantStorage, loadOrCreateSecret, loadPublishToken } from './bridge-files';
import { createFanout } from './fanout';
import { createMinuteAggregator, DEFAULT_METRICS_DAYS } from './metrics';
import { appendMetricsRecord, metricsDir, pruneMetrics } from './metrics-store';
import { runMetricsReport } from './metrics-cli';
import { createPublisher } from './publisher';
import { parseRelaysFile, targetsFromUrls } from './relays';
import type { RelayTarget } from './relays';
import { sanitizeEvent, sanitizeState } from './sanitize';
import { createSyntheticFeed } from './synthetic-feed';

const DEVICE_NAME = 'Orbs Office Bridge';
const DEFAULT_RELAY = 'ws://localhost:8787/publish';
const MIN_SEND_INTERVAL_MS = 250;
const KEEPALIVE_MS = 30_000;
const SETTINGS_DEBOUNCE_MS = 200;
/** The cross-relay viewer total is re-sent this often, so relays keep treating it as fresh while it does not change. */
const TOTAL_REFRESH_MS = 10_000;
const METRICS_SAMPLE_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RELAYS_FILE = 'relays.json';

/** Local time with offset, e.g. 2026-11-10T14:03:05+01:00, so gaps in the log can be matched to what happened. */
function localIso(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`;
}

const log = (line: string): void => console.log(`${localIso(new Date())} [bridge] ${line}`);

function flag(args: readonly string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

async function pair(args: readonly string[]): Promise<void> {
  const daemon = flag(args, 'daemon');
  const pin = flag(args, 'pin');
  if (daemon === null || pin === null) {
    log('usage: bridge pair --daemon http://localhost:47191 --pin 123456');
    process.exit(2);
  }
  const result = await redeemPairing(daemon, pin, DEVICE_NAME);
  fileGrantStorage.save({ daemonUrl: normalizeDaemonUrl(daemon) ?? daemon, token: result.token, serverId: result.serverId });
  log('paired; grant stored in ~/.config/orbs-office/bridge-grant.json');
}

function allFlags(args: readonly string[], name: string): string[] {
  return args.flatMap((arg, index) => (arg === `--${name}` && args[index + 1] !== undefined ? [args[index + 1] as string] : []));
}

function expandPath(path: string): string {
  return path === '~' || path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path;
}

/** A token file must be private: group/other access is refused, like an ssh key. */
function readTokenFile(path: string): Result<string> {
  try {
    if ((statSync(path).mode & 0o077) !== 0) return { ok: false, error: 'permissions too open; run chmod 600 on it' };
    const text = readPrivateFile(path)?.trim() ?? '';
    return text.length > 0 ? { ok: true, value: text } : { ok: false, error: 'empty' };
  } catch {
    return { ok: false, error: 'cannot be read' };
  }
}

function defaultToken(): string {
  const token = loadPublishToken();
  if (token === null) {
    log('no publish token: set ORBS_OFFICE_PUBLISH_TOKEN or create ~/.config/orbs-office/publish-token');
    process.exit(2);
  }
  return token;
}

/** `--relay` flags win; else relays.json; else the single local default (the old behaviour). */
function resolveTargets(args: readonly string[]): RelayTarget[] {
  const urls = allFlags(args, 'relay');
  let result: Result<RelayTarget[]>;
  if (urls.length > 0) {
    result = targetsFromUrls(urls, defaultToken());
  } else {
    const file = readPrivateFile(configPath(RELAYS_FILE));
    result = file === null ? targetsFromUrls([DEFAULT_RELAY], defaultToken()) : parseRelaysFile(file, { expandPath, readToken: readTokenFile });
  }
  if (!result.ok) {
    log(result.error);
    process.exit(2);
  }
  return result.value;
}

/** `--metrics-days N`: how long monthly viewer-metrics files are kept. */
function metricsDays(args: readonly string[]): number {
  const text = flag(args, 'metrics-days');
  if (text === null) return DEFAULT_METRICS_DAYS;
  const days = Number(text);
  if (!/^\d+$/.test(text) || days < 1 || days > 36_500) {
    log('--metrics-days must be a whole number of days, 1 or more');
    process.exit(2);
  }
  return days;
}

function run(args: readonly string[]): void {
  const keepDays = metricsDays(args);
  const synthetic = args.includes('--synthetic');
  const targets = resolveTargets(args);
  if (!synthetic && fileGrantStorage.load() === null) {
    log('not paired with a daemon: run "bridge pair" first');
    process.exit(2);
  }

  const secret = loadOrCreateSecret();
  const first = readSettings();
  if (!first.ok) log('settings file unreadable; starting with default settings');
  let settings = first.ok ? first.value : emptySettings();
  const feed = synthetic ? createSyntheticFeed() : createOfficeFeed({ grants: fileGrantStorage, deviceName: DEVICE_NAME });
  const publisher = createFanout(targets.map((target) => createPublisher(target.name, target.url, target.token, log)), log);

  // Viewer counts, one line per UTC minute (see metrics.ts). Only counts and relay names are stored.
  const aggregator = createMinuteAggregator();
  const sampleMetrics = (): void => {
    try {
      for (const record of aggregator.record(Date.now(), publisher.sample())) appendMetricsRecord(metricsDir(), record);
    } catch {
      log('could not write viewer metrics');
    }
  };
  const pruneOldMetrics = (): void => {
    try {
      const removed = pruneMetrics(metricsDir(), Date.now(), keepDays);
      if (removed.length > 0) log(`removed ${removed.length} viewer metrics file(s) older than ${keepDays} days`);
    } catch {
      log('could not prune viewer metrics');
    }
  };
  publisher.onChange = sampleMetrics;
  pruneOldMetrics();
  setInterval(sampleMetrics, METRICS_SAMPLE_MS);
  setInterval(pruneOldMetrics, DAY_MS);

  let lastSentKey = '';
  /** Bots in the last published snapshot; events about any other bot would reveal one the snapshot leaves out. */
  let publishedIds: ReadonlySet<string> = new Set();
  let lastSentAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function build(state: OfficeState): PublicSnapshot | null {
    const snapshot = sanitizeState(state, settings, secret, Date.now());
    const checked = validatePublicSnapshot(snapshot);
    if (!checked.ok) {
      log(`dropped snapshot: ${checked.error}`);
      return null;
    }
    return checked.value;
  }

  function flush(force: boolean): void {
    timer = null;
    const state = feed.getState();
    // While the daemon is unreachable keep silent: viewers see the snapshot age instead of a wrong "idle".
    if (state.connection.kind !== 'connected' || !publisher.anyConnected) return;
    const snapshot = build(state);
    if (snapshot === null) return;
    const key = JSON.stringify(snapshot.bots);
    const now = Date.now();
    if (!force && key === lastSentKey && now - lastSentAt < KEEPALIVE_MS) return;
    lastSentKey = key;
    lastSentAt = now;
    publishedIds = new Set(snapshot.bots.map((bot) => bot.id));
    publisher.send({ t: 'snapshot', snapshot });
  }

  function schedule(): void {
    if (timer !== null) return;
    timer = setTimeout(() => flush(false), Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - lastSentAt)));
  }

  /** A relay that just (re)connected gets the current snapshot at once; the others are not bothered. */
  publisher.onRelayConnect = (name) => {
    const state = feed.getState();
    if (state.connection.kind !== 'connected') return;
    const snapshot = build(state);
    if (snapshot !== null) publisher.sendTo(name, { t: 'snapshot', snapshot });
  };

  feed.subscribe((event) => {
    if (event.kind === 'state') {
      schedule();
      return;
    }
    const publicEvent = sanitizeEvent(event, secret);
    const checked = publicEvent === null ? null : validatePublicEvent(publicEvent);
    if (checked === null || !checked.ok || !publishedIds.has(checked.value.bot)) return;
    publisher.send({ t: 'event', event: checked.value });
  });

  // Watch the directory: the settings file is replaced by rename on every write.
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(configDir(), (_event, filename) => {
    if (filename !== 'settings.json') return;
    if (settingsTimer !== null) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      const reloaded = readSettings();
      if (reloaded.ok) {
        settings = reloaded.value;
        log('settings reloaded');
      } else {
        log('settings file unreadable; keeping the last valid settings');
      }
      flush(true);
    }, SETTINGS_DEBOUNCE_MS);
  });
  setInterval(() => flush(false), KEEPALIVE_MS / 3);
  setInterval(() => publisher.refreshTotal(), TOTAL_REFRESH_MS);

  const shutdown = (): void => {
    watcher.close();
    publisher.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  log(`running${synthetic ? ' (synthetic feed)' : ''}; publishing to ${targets.map((target) => target.name).join(', ')}`);
}

const [command = 'run', ...rest] = process.argv.slice(2);
if (command === 'pair') {
  await pair(rest);
} else if (command === 'metrics') {
  runMetricsReport(rest, log);
} else if (command === 'run' || command.startsWith('--')) {
  run(command.startsWith('--') ? [command, ...rest] : rest);
} else {
  log('commands: pair, run, metrics');
  process.exit(2);
}
