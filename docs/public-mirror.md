# Public mirror

A read-only, 24/7 public view of the office. Nothing private ever leaves the machine:
the bridge reduces the office state to a fixed allow-list, and the relay re-validates
everything it receives.

```
 Orbs daemon (local)            this machine                     Cloudflare                 browsers
 ┌────────────┐  oRPC/WS   ┌─────────────────────┐  wss (out)  ┌──────────────────┐  wss   ┌─────────┐
 │  private   │ ─────────▶ │ bridge (bun)        │ ──────────▶ │ Worker           │ ─────▶ │ viewers │
 │  bot state │            │  feed -> sanitize   │  Bearer     │  + OfficeRelay   │ /live  │ (public │
 └────────────┘            │  -> validate -> push│  token      │  Durable Object  │        │  app)   │
                           └─────────────────────┘             │  validate again  │        └─────────┘
                                                               └──────────────────┘
```

The bridge only makes outbound connections. No inbound port is opened on the owner's machine.

## Running more than one relay

One bridge can publish to several relays at once, and the public page fails over between them in priority order.
The intended set-up is three relays: a Hetzner server (primary), a home server (first backup) and the Cloudflare Worker
(second backup, which also serves the page).

```
                         +--> relay 1  standalone Bun (Hetzner)   <--+
 bridge --one socket each-+--> relay 2  standalone Bun (home)       <--+-- page: tries 1, then 2, then 3
                         +--> relay 3  Cloudflare Worker + DO     <--+
```

Both relay kinds are thin adapters over `shared/relay-core.ts` (publisher frame handling, caps, abuse rules, viewer
counts, persistence timing), so they behave identically. The standalone one is `relay-server/`; see
`docs/deploy-relay-server.md`.

Bridge: repeat `--relay`, or list relays in `~/.config/orbs-office/relays.json` (used when no `--relay` is given;
token files must be mode 0600, at most 5 relays):

```json
[
  { "name": "hetzner", "url": "wss://office-live1.example.com/publish", "tokenFile": "~/.config/orbs-office/publish-token-hetzner" },
  { "name": "home", "url": "wss://office-live2.example.com/publish", "tokenFile": "~/.config/orbs-office/publish-token-home" },
  { "name": "cloudflare", "url": "wss://office.example.com/publish", "tokenFile": "~/.config/orbs-office/publish-token-cloudflare" }
]
```

Each relay has its own connection with its own reconnect backoff and heartbeat; snapshots and events go to every
connected relay, one being down never delays the others, and log lines are tagged with the relay's name. With a single
`--relay` and the default token file nothing changes. `bun run bridge --synthetic` publishes four invented bots
instead of reading the daemon (testing only).

**Page failover.** The page reads its endpoint list, in priority order, from `public.html`:

```html
<meta name="office-hosts" content="office.example.com,office.example.org" />
<meta name="office-relays" content="wss://office-live1.example.com,wss://office-live2.example.com,self" />
```

`self` is the host that served the page (so it works unchanged on every hostname); without the meta the page uses
`self` only. The build derives the CSP from the same two lists: `connect-src 'self'` plus explicit `wss://` and
`https://` entries for every page host and every relay, nothing else. Weights are deliberately not supported: order is
the only priority. Behaviour:

- It connects to the first endpoint. A socket that has not opened within 5 s, a ping that is not answered within 10 s,
  a close, a busy refusal (close code 4429) or 90 s without any new snapshot move it to the next endpoint at once
  (spread over 0 to 1.5 s). Silent-relay moves go around at most once, because every relay is silent when the
  publisher is gone.
- After a full pass in which nothing worked it backs off (1 s up to 30 s, jittered; slower if every relay was full)
  and starts polling `/state.json`, trying the selected endpoint first, then the others. The last state stays on
  screen throughout.
- While on a lower-priority endpoint it probes the higher ones with `GET /healthz` every 60 to 120 s (jittered) and
  switches back to the first one that answers. Moves that no failure forced (switching back, leaving a silent relay)
  are never closer together than 20 s.
- A hidden tab disconnects; on return it starts again from the first endpoint.
- Debug aid: `<html data-relay="N">` holds the index of the endpoint in use (an index, not a hostname).
- A snapshot only counts as a sign of life if it is newer than any seen, because a relay gives every new viewer its
  stored snapshot; hopping between relays therefore cannot make a dead feed look live.

The Worker answers `GET /healthz` (a cheap 200, without waking the Durable Object). A standalone relay needs the
page's origins in `ALLOWED_ORIGINS` so the page may open `/live` and read `/state.json` and `/healthz` cross-origin.

**One synced viewer total.** Each relay counts its own viewers and tells the publisher over the publisher socket with
`{"t":"count","n":N}` whenever the count changes (coalesced to one per 3 s, and again on every new publisher
connection). The bridge sums the latest counts of the relays that are connected and sends `{"t":"viewers","n":TOTAL}`
to every relay when the total changes, and every 10 s regardless. A relay shows its viewers (socket frames,
`/viewers.json`, `/state.json`) that publisher-provided total while it is fresh (received within 30 s), and its own
local count otherwise: right away when the publisher disconnects, after 30 s if the bridge just goes quiet. A relay
that is down is simply missing from the sum. A viewer that polls one relay and a viewer on another see the same number
within a few seconds.

## Metrics

Viewer counts are kept over time so a chart can be drawn later. Counts only: see "Not recorded" below.

**Bridge time series.** The bridge already receives each relay's viewer count and computes the synced total. Once per
UTC minute it appends one line to `~/.config/orbs-office/metrics/viewers-YYYY-MM.jsonl` (monthly files, directory 0700,
files 0600, one `appendFile` of a full line so a crash leaves at worst a torn last line, which readers skip):

```json
{"t":"2026-11-10T20:31:00Z","total":12,"max":15,"relays":{"hetzner":10,"home":0,"cloudflare":2},"connected":["hetzner","cloudflare"]}
```

- `t`: start of the UTC minute. `total`: the last synced total in that minute. `max`: the peak total seen in it.
- `relays`: the latest count per configured relay name (0 for a relay that is down or has not reported; with a single
  `--relay` the name is the relay's host). `connected`: the relay publisher sockets that were up at the end of the minute.
- A minute in which no relay was connected, or in which the bridge was not running, has no line: a gap means
  "bridge offline", not "zero viewers". A minute still open when the bridge stops is not written.
- Retention: monthly files are kept 400 days (a file goes once the whole month is older than that). Change it with
  `bun run bridge --metrics-days N`. Files are pruned at startup and then daily.

**Report.** Read-only; it never contacts the daemon or a relay:

```sh
bun run bridge metrics                                   # last 7 days, hourly, table
bun run bridge metrics --since 24h --step 5m
bun run bridge metrics --since 2026-11-01 --until 2026-11-08 --step 1d --format csv > week.csv
bun run bridge metrics --since 7d --step 1h --format json   # { rows: [{t, avg, max, minutes}], summary }
```

`--since` / `--until` take `7d`, `24h`, `90m`, a date (`2026-11-01`, UTC midnight) or an ISO time (UTC unless it has an
offset); `--until` is exclusive and defaults to now. `--step` is `1m`, `5m`, `1h` or `1d` (UTC-aligned). Per step:
`avg` is the mean total per sampled minute, `max` the peak, `minutes` the number of sampled minutes. The table ends
with a summary: peak with its timestamp, average, and viewer-minutes (the sum of the per-minute totals).

**Prometheus endpoint (standalone relay only).** `GET /metrics`, text format, served only when the request is
permitted; otherwise the server answers 404 as if the path did not exist:

- `METRICS_TOKEN` (at least 32 characters): `Authorization: Bearer <token>` grants access.
- `METRICS_ALLOW_LOOPBACK=1`: also grants access when the socket peer is loopback or a private address (Docker's
  bridge counts) and the request carries no Cloudflare or proxy header (`CF-*`, `X-Forwarded-*`, `Forwarded`, `X-Real-IP`).
  Tunnel traffic always carries them, so it is refused.

With neither set the endpoint does not exist. Do not add a route for `/metrics` to the tunnel: the server refuses it
anyway, but there is no reason to expose it. Counters live in the server process and reset on restart (Prometheus
handles that). The Cloudflare Worker has no `/metrics`.

| Metric | Type | Meaning |
|--------|------|---------|
| `orbs_office_viewers` | gauge | viewer sockets open on this relay |
| `orbs_office_viewers_total` | gauge | the total viewers are shown (synced cross-relay total while fresh) |
| `orbs_office_viewer_connections_total` | counter | admitted viewer connections |
| `orbs_office_viewer_rejections_total{reason}` | counter | refused viewers: `busy` (relay full), `origin` (foreign Origin), `ip` (per-IP cap) |
| `orbs_office_publisher_connected` | gauge | 1 while a publisher is connected |
| `orbs_office_publisher_frames_total{result}` | counter | `accepted`, `invalid`, `rate_limited` |
| `orbs_office_snapshot_age_seconds` | gauge | seconds since the newest snapshot frame (absent before the first) |

Scrape config for a Prometheus on the same host as the relay (the compose file publishes `127.0.0.1:8790`; with
`METRICS_ALLOW_LOOPBACK=1` no credentials are needed):

```yaml
scrape_configs:
  - job_name: orbs-office-relay
    metrics_path: /metrics
    static_configs:
      - targets: ["127.0.0.1:8790"]
    # With METRICS_TOKEN instead:
    # authorization: { credentials_file: /etc/prometheus/orbs-office-metrics-token }
```

If Prometheus itself runs in a container, use the token variant rather than loopback.

**Not recorded.** No per-visitor data and no unique-visitor counts: the mirror sets no cookies, no storage and logs no
IP addresses, so there is nothing to count visitors with, and none is added. Metrics have no IP, hostname, user agent or
bot data; labels are fixed words. A "viewer" is an open socket, so one person with two tabs counts twice and a person who
only polls the JSON endpoints is not counted.

## What is sent (the complete allow-list)

Defined in `shared/public-snapshot.ts`; the bridge, the relay and the app all use the same validator,
which rejects unknown keys, wrong types, out-of-range values, strings off-pattern and payloads over 64 KB.

```
Snapshot { v: 1, at: ms rounded to 10 s, bots: Bot[<=64] }
Bot {
  id:    16-char base32 opaque id = HMAC-SHA256(local secret, real bot id)
  name:  owner-chosen public name ([A-Za-z0-9 ._'-], 1..32) or "Agent NN" (NN = rank+1)
  color: "#rrggbb"
  figure: "male" | "female"
  island: "auto" | "A".."F"
  rank:  0..63
  activity: idle | thinking | waiting | tool{family: terminal|web|file|mcp|message|other}
            | meeting{with: opaque ids}
  subagents: 0..8
  runStartedAgoSec: multiple of 10, or null
}
Event { kind: "mail" | "reply" | "failed", bot: opaque id }     // no text, ever
```

Frames: publisher to relay `snapshot`, `event` and `viewers` (`{t:'viewers', n}`, the cross-relay total, never
forwarded as is); relay to publisher `count` (`{t:'count', n}`, that relay's own viewer count); relay to viewers
`snapshot`, `event`, `viewers`.

Never sent: real names or handles, avatars, message text or previews, run titles, triggers, tool names
or inputs, tokens or costs, routines, approval counts, conversation ids, the daemon URL or server id,
timestamps finer than 10 s. The tool family is derived locally; the tool name is dropped.

## Files (all in `~/.config/orbs-office`, directory 0700, files 0600)

| File | Purpose |
|------|---------|
| `settings.json` | Owner settings (figures, islands, public names). Served by the dev server at `/office-settings` to loopback clients only; the bridge watches it. |
| `bridge-grant.json` | Daemon pairing grant for the bridge. |
| `bridge-secret` | 32 random bytes (hex) behind the opaque ids. Deleting it only reshuffles public ids. |
| `metrics/viewers-YYYY-MM.jsonl` | Viewer counts per minute written by the bridge (see Metrics). |
| `publish-token` | Token the bridge presents to the relay (or env `ORBS_OFFICE_PUBLISH_TOKEN`). |

## Pair the bridge

```sh
# in the orbs repo: prints a PIN for the running dev daemon
bun run dev:pair
# in this repo
bun run bridge pair --daemon http://localhost:47191 --pin 123456
```

It appears in Orbs as the device "Orbs Office Bridge" and can be revoked there.

## Run locally

```sh
cd worker && bun install
printf 'PUBLISH_TOKEN=%s\n' "$(openssl rand -hex 32)" > .dev.vars     # local only, gitignored
bun run dev                                                           # wrangler dev on :8787
# put the same token where the bridge reads it
(umask 077; grep PUBLISH_TOKEN worker/.dev.vars | cut -d= -f2 | tr -d '\n' > ~/.config/orbs-office/publish-token)
bun run bridge --relay ws://localhost:8787/publish
```

The relay: `GET /live` (viewer WebSocket), `GET /snapshot.json` (latest snapshot), `GET /publish`
(publisher WebSocket, bearer token), everything else is static assets from `worker/public-dist/`.
Relay logic is shared with the standalone server (`shared/relay-core.ts`). `ws://` is only accepted by the bridge for localhost; remote relays need `wss://`.

## Deploy (not executed yet)

```sh
bun run build:public                      # in the repo root: builds the public page into worker/public-dist/
cd worker
bun install
openssl rand -hex 32                      # generate the publish token
bunx wrangler secret put PUBLISH_TOKEN    # paste it; never store it in the repo
bunx wrangler deploy
# on the owner's machine
(umask 077; printf '%s' '<token>' > ~/.config/orbs-office/publish-token)
bun run bridge --relay wss://<worker-host>/publish
```

Build the public app into `worker/public-dist/` first (see below); `wrangler deploy` uploads that folder as the static assets.
Relay hardening: one publisher at a time per relay (a newer authenticated one replaces the old), 1000 viewers,
5 connections per IP, viewers are read-only and closed if they send more than a few frames,
`/live` refuses foreign `Origin`s, invalid publisher frames are dropped and counted (never logged).
Not included: rate limiting of `/snapshot.json` polling; add a Cloudflare rate-limiting rule if needed.

## Verify there are no leaks

```sh
bun test bridge shared                    # canary tests: sanitizer + validator
curl -s https://<worker-host>/snapshot.json
```

Compare the JSON against the allow-list above and grep it for every real bot name, handle and id
(none may appear). The tests feed synthetic state full of canary strings through the sanitizer and
assert none survive.

## The public page

`public.html` + `src/public-main.ts` is a separate, read-only entry. `bun run build:public` (type-check, then
`vite build --mode public --config vite.public.config.ts`) cleans `worker/public-dist/` and writes `index.html`
plus hashed assets (about 740 KB of JS, 200 KB gzipped). The folder is git-ignored: it is a build output, so
build before every deploy. (The old tracked placeholder `index.html` there is replaced by the build; run
`git rm --cached worker/public-dist/index.html` once.)

What the page shows: the scene from the snapshot only. Name, colour, figure, island, rank, coarse activity
(tool family icon, waiting, meeting, thinking, idle), helper count and run age. In the legend: the public name
and a coarse activity word (Working / Waiting / In a meeting / the idle place such as At desk or Sleeping).
Clicking a bot or a legend row only highlights it.

What it makes up, in the browser, at random on every load: reply bubbles (2 to 12 lorem-ipsum words),
and the "Next routines" board in the mailroom (names like "Lorem sync - 14:30", refreshed now and then).
Kitchen, games and lunch chatter is the same gibberish as in the private app. The "waiting" bubble shows
"?" with no number because approval counts are not public.

What it never has: pairing, oRPC, chat history or sending, the instruction popup, Markdown, the settings
dialog, the bot menu, the settings endpoint client, the preview feed, avatars, dev hooks (`?preview`,
`?demo`, `?sheet`, `?clock`, `window.__office3d`). The bundle contains none of these strings (checked by grep
after each build). No cookies, localStorage, sessionStorage or IndexedDB are used, and no third-party
request is made (no fonts, CDNs or analytics), so no consent banner is needed.

Data flow: WebSocket `wss://<first endpoint>/live` (see "Running more than one relay"; by default the same host), reconnecting with backoff and jitter; if it keeps failing the
page polls `/snapshot.json` every 10 s. Every frame is validated with `shared/public-snapshot.ts`; invalid
frames are dropped silently. With no frame for 90 s the page shows "Live feed paused" and keeps the last
state. A hidden tab closes its socket (and reconnects when shown again), so it does not hold one of the 1000
viewer slots. Pixel ratio is capped at 1.5. Without WebGL the page shows a plain explanation.

### Cost

Estimates, not quotes: check current Cloudflare pricing and your plan's limits, and turn on billing and usage
notifications in the dashboard before posting the link anywhere.

What runs the Worker (a billed Worker request): `/live`, `/publish`, `/state.json`, `/snapshot.json`,
`/viewers.json` only (`run_worker_first` in `wrangler.jsonc`). The page, its JS and CSS are static assets served
without the Worker (their headers come from `worker/public-dist/_headers`, generated by `build:public` from
`shared/security-headers.ts`; hashed assets are `immutable`). The three JSON routes are shared at the edge for 5 s
through the Cache API, so most polls never reach the Durable Object.

What wakes the Durable Object: publisher frames, a viewer connecting or disconnecting, the relay's single alarm, and
JSON polls that miss the edge cache. What does not: `ping`/`pong` (answered by the runtime through
`setWebSocketAutoResponse`, publisher heartbeat and viewer keepalives alike) and viewers sitting on hibernated
sockets. Fan-out sends to viewers are outgoing messages, not billed requests.

Storage: the newest snapshot is kept in memory and written at most once per 60 s, and only when the bots actually
changed (keepalive snapshots, sent every ~30 s, repeat the same bots and are skipped). One alarm serves both the
trailing storage write and the 3 s viewer-count coalescing. If the object hibernates inside the 60 s window the pending
write is lost, so a new viewer may briefly see the previous stored state until the next publisher frame (at most ~30 s).

Rough daily budget:

| | Idle office (publisher keepalives only) | Busy office (4 snapshots/s all day) |
|---|---|---|
| Publisher frames (DO requests) | ~2,900 (one per 30 s) | ~345,000 (up to 4/s) |
| Storage writes | a few per day (only on change) | ~1,440 (one per minute) |
| DO duration | short bursts, hibernates between frames | awake all day: ~86,400 s wall time, billed on the 128 MB GB-s basis |
| Viewer connect/disconnect | 2 DO requests per visit | same |

Viral day, 100,000 visits with up to 2,000 concurrent (the relay holds 1,000; the rest see "Busy: showing delayed
updates" and poll):
- Worker requests: ~100k page loads are static (not billed as Worker requests). The Worker sees one `/live` per visit that
  gets a socket (about 100k) plus polls. Polls: the edge cache absorbs most; assume ~1 in 6 misses, so 1,000 pollers at
  one request per 30 s is ~2,900 polls per hour per cache location, a few tens of thousands a day at most. Total on the
  order of 100k to 200k Worker requests.
- DO requests: ~100k connects plus ~100k disconnects (WebSocket messages are billed at a 20:1 ratio on the paid plan, upgrades and
  closes count as requests) plus publisher frames above, so roughly 200k to 600k.
- DO duration: with viewers connected the object is not hibernated during busy periods; assume up to 24 h of duration
  at 128 MB (about 3,000 GB-s), which is inside the paid plan's included amount.
- Storage writes: unchanged, at most ~1,440 per day.
- Free plan: the daily Worker request limit (100k) and the free Durable Object request and duration limits will be
  reached on such a day; past them requests fail with errors (the page keeps its last state and shows "Paused"), you are
  not charged. The Workers Paid plan removes the hard stop; the figures above sit inside its included allowances
  or cost cents, but verify against current pricing.

### Office time zone

Everything that depends on the time of day (work hours 07:00-19:00 Mon-Fri, lunch 12:30-14:00, going to bed,
the routines board times, and later daylight) uses the owner's office zone, not the viewer's, so all viewers see
the same phase. It is set in `public.html`:

```html
<meta name="office-timezone" content="Europe/Luxembourg" />
```

Change that value and rebuild. The shared clock is `src/office3d/office-clock.ts` (`officeParts(ms)`,
`toOfficeDate(ms)`, `formatOfficeClock(ms)`); the private app has no such tag and keeps the device's clock.

### Search engines

`public.html` carries `<meta name="robots" content="noindex, nofollow">`. Delete that line to allow indexing.

### CSP

`shared/security-headers.ts` (used by the Worker and the build) already fits the built page (hashed same-origin module script and stylesheet,
`data:` icons, `blob:` workers allowed, no inline script). `connect-src` is generated: `'self'` plus `wss://` and `https://` for every host in the `office-hosts` meta and every relay in `office-relays`. The one
relaxation that was already there is `style-src 'unsafe-inline'`, which the scene's runtime-injected style
elements and inline `style` attributes need; scripts stay `'self'` only.
