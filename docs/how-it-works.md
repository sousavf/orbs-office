# How Orbs Office works

A live 3D office that shows Orbs bots at work. A real building built in Three.js (six named desk islands and solo desks, a kitchen with long lunch tables, a mailroom with a routines board, an approvals counter, meeting rooms, lounges, a dormitory and a games room) with the bots as cartoon characters that always face the camera. Each bot has its own desk; its character reflects what the daemon reports:

| Daemon state | In the office |
| --- | --- |
| No live run | Follows the daily routine (below): sits at its desk, takes short breaks, eats at lunch, sleeps in its bed after hours. Walks to the desk when a run starts and back to its routine place afterwards |
| Working, but no live run in its main chat (for example in a private conversation with another bot) | Shown thinking at its desk, without a tool bubble |
| `thinking` span | Walks to the desk if needed, typing, monitor on, thought bubble |
| `tool` span | Bubble by tool family: terminal, web, file, MCP, other |
| `waiting` span | Walks to the approvals counter, "?" with the pending count |
| Bot message to a peer that is running a `peer` run | Both walk to a meeting room |
| Subagents in the run | Small "interns" beside the parent's desk |
| New user message, routine or peer run | A courier carries an envelope from the mailroom to the desk |
| Failed run | Brief "!" badge |

## Daily routine

Where an idle bot is depends on the time of day (local time, from the shared settings; defaults Monday to Friday, 07:00 to 19:00, lunch 12:30 to 14:00). Real activity always wins; this is only what bots do with nothing to do.

| Phase | Idle bots |
| --- | --- |
| `work` | Sit at their own desk (sitting, monitor off). Every 8 to 15 minutes (random per bot, staggered, at most about 30 percent of the idle bots at once) a bot takes a 1.5 to 3 minute break: kitchen (small talk), water cooler (30 to 60 s), lounge sofa, or the games room |
| `lunch` | Walk to a free lunch seat, a tray appears, they eat with pauses and talk with their table neighbours; trays vanish when they leave and everyone is back at the desk by lunch end. A bot whose run ends mid-lunch joins lunch |
| `winddown` | The last hour: longer, more frequent breaks, mostly kitchen and games |
| `off` | After hours, weekends and days off: each bot walks to its own bed (the bed of its desk number; bots past the last desk sleep on a lounge sofa), the sprite hides, a blanket and pillow show it asleep and a small "Zzz" floats over the pillow. A run wakes it: it steps out of bed and walks to its desk, then back to bed |

Games room: pool and table football need two players. A bot on a break joins a waiting partner or waits at the table up to about 20 s for one, otherwise it falls back to the console (one or two seats, the TV is lit while it is in use) or the kitchen. Pool alternates turns with balls that roll, collide, slow down, stop and sometimes drop (the table is re-racked when few are left); table football rods slide and twist and the ball runs about. Players trade short lines in speech bubbles. When one leaves, the other finishes up and goes to the console or the kitchen.

Settings `workingHours` (`enabled`, `days` 0 = Sunday to 6, `start`, `end`, `lunchStart`, `lunchEnd`, all `HH:MM`) drive it; with `enabled: false` the office stays in the `work` phase all day. A phase change reaches each bot within about a minute so nobody moves in lockstep. No bot moves instantly: every change is a walk (except with reduced motion, which jumps to the final place and stops animations).

Desks: each bot's island can be set to Automatic, one of the six islands, or a solo desk (menu below). A chosen island gives the first free desk there; a full island or solo area falls back to Automatic, which keeps a bot at the desk of its roster rank when free and otherwise takes the first free desk. Nothing about desks is stored; they follow from the roster and the choices.

A walk always finishes where it was headed; the bot then follows the latest state, after a short pause at its desk, the approvals counter or a meeting seat when that state has already ended. Bubbles follow the real state at once, even mid-walk. Names, state bubbles and the bot's latest chat reply float above each character as DOM. The mailroom board and the legend list the next routines; the walls nearest the camera are cut away. The scene follows the time of day (see Day and night below) and `prefers-reduced-motion`; the legend and dialogs follow the system light/dark setting.

## Day and night

The 3D scene lights itself from the office clock, independent of the UI colour scheme. `src/office3d/daylight.ts` (pure) computes the sun for a fixed place in central Europe (Luxembourg, no geolocation), so sunrise and sunset move with the season, and eases through about 45 minutes of twilight. By day a shadow-casting sun comes from its real azimuth and each window facing it throws a soft patch of light on the floor; the window panes show the sky. At night the sun is gone and the office is lit by lamps only: ceiling light pools over rooms that are in use (rooms with nobody in them after hours stay dim), lamps on the desks where a bot sits, monitor spill, warm kitchen and lounge lamps, low night-lights in the dormitory while bots sleep, the pool table lamp and the TV glow; windows show dark sky with a few city lights. Real lights are one hemisphere light, the sun, a camera-side fill and eight point lamps; the rest of the glow is additive decals. The page backdrop behind the canvas follows the scene (CSS variables `--scene-*`, `data-scene` on `<html>`). Settings has a "Lighting" choice: follow the clock, always day, always night (stored as `lighting: { mode }`, applied live). The clock is `ScheduleClock`, so `?preview&clock=` and `&timeScale=` drive it too. The sun is computed from the office's wall-clock fields with central European summer-time rules, so a device in another time zone sees the sun a little off.

## Run

```sh
bun install
bun run dev        # http://localhost:5190
```

Pair it with a daemon:

1. In the Orbs repo, run `bun run dev:pair` (dev daemon) or `orbs pair` (installed daemon) and note the PIN.
2. Open the app, enter the daemon URL (dev default `http://localhost:47191`) and the PIN.

The grant is stored in this browser's localStorage. "Disconnect" forgets it.

Everything goes over the daemon's `/rpc` WebSocket, pairing included. The daemon accepts WebSocket connections from `localhost` and IP origins, so the dev server works without changing `DAEMON_ALLOWED_ORIGINS`. Serving the app from another hostname needs that origin added there.

## Controls

- Camera: drag to pan, wheel or pinch to zoom, arrow keys to pan, `+` / `-` to zoom, `0` to refit.
- Rotate the view in 90 degree steps with `Q` / `E` or the two buttons at the bottom left.
- Hover a bot for a tooltip (run title, trigger, elapsed time, tool calls, tokens).
- Click a bot, its reply bubble or a legend row to open the chat panel, docked at the bottom left (a bottom sheet on phones). It shows the recent conversation and a box to message the bot; drafts are kept per bot. The open bot keeps its name showing. A press anywhere outside the panel closes it (a press on another bot or legend row switches to that bot), as does `Escape` or the close button.
- Right-click a bot in the legend (long-press on touch, or the Menu key / Shift+F10 on a focused row) for its menu: Figure (male or female), Island (Automatic, the six islands by their current names, or Solo desk) and "Public name..." (an inline field: 1 to 32 letters, numbers, spaces and `. _ ' -`; Enter saves, Escape cancels, empty clears it and the public mirror shows "Agent NN"). Choices are saved in the shared settings. A bot with a public name shows "Public: name" under its legend row.
- The gear button in the legend header opens "Office settings": the six island sign names, the working days, day start and end, lunch start and end and whether the schedule is on.
- The legend and tooltip say what an idle bot is doing: At desk, On a break, In the lounge, Playing pool, Playing table football, Playing console, At lunch, Heading to bed, Sleeping.

## Dev hooks

- `?preview` runs a scripted fake feed with three bots, without a daemon; `?preview&bots=N` uses N bots (handy for load checks). In preview mode `window.__office3d` exposes the crowd, camera rig and renderer for debugging, and settings edits stay in memory (the shared settings file is never read or written).
- Schedule previews, preview only: `&clock=HH:MM` starts the simulated day there, `&day=sat` picks the weekday, `&timeScale=N` runs the schedule N times faster (breaks, lunch and phase changes; walking keeps its real speed). `&clock=` also makes the fake office quiet (one bot at a time works briefly); `&quiet=still` or `&quiet` alone sets that without a clock; `&quiet=still` means nobody works. Examples: `?preview&bots=30&clock=10:00` desks, breaks and games; `&clock=13:00` lunch; `&clock=21:00` sleeping; `&clock=10:00&day=sat` weekend. `&date=MM-DD` moves only the sun to another day of the year (e.g. `&clock=17:30&date=05-15` for a summer afternoon, since the real date may already be dark at 17:30); `window.__office3d.lighting` exposes the current daylight and light levels.
- `window.__previewControl.setActivity(botId, { kind: 'thinking' } | null)` forces a fake bot's activity (`roster` lists the ids), for stepping through wake-up and return walks.
- `?preview&demo=rooms` (kept as a dev hook; the schedule supersedes it for normal use) also places fake bots by hand in every room (eating at the lunch tables with trays, a pool pair, a foosball pair, two on the console, lounging, sleeping in bunks, at solo desks and islands), and exposes `window.__rooms` with `focus('dorm' | 'games' | 'pool' | 'foosball' | 'console' | 'kitchen' | 'lunch' | 'islands' | 'solo' | 'hall' | 'all')` for close-ups. It lives in `src/office3d/demo/` and nothing else depends on it.
- `?sheet=<kind>` shows a contact sheet of one character sprite sheet (see `src/office3d/sprites/contact-sheet.ts`); add `&set=activity` for the eat, pool, foosball, console and lounge poses.

## Data used (read-only)

`conversation.watchList` (roster and working state), `activity.list` and `activity.run` (spans, agents and handoffs of the live run, polled every 1.5 s while a bot works), `tools.pending` (only while waiting), and `routines.list` (every 60 s). The client types in `src/orbs/orbs.types.ts` mirror the subset of `orbs/packages/contracts` that the app reads; update them if those contracts change.

## Layout

```
src/orbs/        oRPC client, pairing, hand-written contract types
src/connection/  pairing panel, stored grant
src/feed/        live feed -> OfficeState and events (office.types.ts is the contract; office-selectors.ts derives views of the state)
src/ui/          legend and tooltip, chat panel, settings, activity text, preference stores, preview feed
src/office-contracts.ts   the small interfaces the scene and the UI share (they never import each other; main.ts and public-main.ts wire them)
src/office-clock.ts       the office's wall clock and time zone (scene and UI)
src/office3d/    the 3D office
  layout*.ts, nav-grid.ts            rooms, furniture, seats, beds, desk slots in metres; square A* grid
  world*.ts, props/, materials.ts    Three scene: floors, walls with cutaway, procedural props, lights
  daylight.ts, lighting-model.ts     pure sun/sky model and the light levels it implies (lamps by room, sky, backdrop)
  scene-lighting.ts, sun-patches.ts, light-pools.ts   drives day and night, window sun patches, additive light pools
  rigs/                              the parts of the world that change: sleepers, lunch trays, island signs, games, TV
  demo/                              dev-only `?demo=rooms` scene (hand-placed bots for close-ups)
  camera-*.ts                        orthographic iso camera, pan/zoom/rotate, input, buttons
  sprites/                           canvas-baked character sheets, head atlas, poses
  character*.ts, blob-shadows.ts     one billboard quad per figure, blob shadows
  actors/                            bot, intern and courier behaviour on a small clock; schedule.ts (phases), routine.ts (idle intent), desk-plan.ts, games/ (pool, foosball, console director)
  overlay/                           DOM labels and bubbles, world to screen projection
  picking.ts, mail-board.ts          hover/click hit-testing, routines board
  crowd.ts, office3d.ts              owns the actors and the feed; mounts and runs the render loop
```

### Rooms (metres, x east, z south, 50 x 24)

```
        0       7        17      30  34              50
 z= 0   +-------+------------------+---+---------------+
        | MEET A|  WORKSPACE       | H | DORMITORY     |
        |  7x6  |  23 x 12         | A | 16 x 9        |
 z= 6   +-------+  islands A..F    | L | 20 bunks      |
        | MEET B|  + sofa, cooler  | L | = 40 beds     |
 z= 9   |  7x6  |                  |   +---------------+
        |       |                  |   | GAMES ROOM    |
 z=12   +-------+------+---+-------+   | 16 x 15       |
        |MAILRM |APPROV|LOB| KITCHEN   | pool,         |
        | 7x6   | 6x6  |4x6| 13 x 12   | foosball,     |
 z=18   +-------+------+---+ 40 lunch  | console,      |
                           | seats     | board games   |
 z=24                      +-----------+---------------+
```

Doors: lobby to the south (entrance at x 14..16), workspace and kitchen to the hall, hall to the dormitory (z 3.7..5.3 on x=34) and to the games room (z 16.5..18.1). The four solo desks stand two beside the mailroom door and two along the approvals room's south wall (the second larger).

Exports of `src/office3d/layout.ts` for the daily routine: `DESK_SLOTS` (each with `id`, `key`, `islandId: 'A'..'F' | 'solo'`, `scale`), `ISLANDS` (`id`, `defaultName`, `center`, `sign`, `deskIds`), `SOLO_DESKS`, `BEDS` (`id`, `bunk`, `level`, `position`, `yaw`, `approach`, `head`), `DORM_LAMPS`, `LUNCH_SEATS` (`id`, `tableId`, `position`, `yaw`, `facing`, `lift`), `LUNCH_TABLES`, `KITCHEN_SPOTS`, `LOUNGE_SEATS`, `COOLER_SPOTS`, `GAMES` (pool, foosball, console: spots or seats with `facing`), `SEAT_FOOTPRINTS` (every seat the nav grid lets a walker start or end inside).

`World.rigs` (`src/office3d/rigs/`) holds the animated parts: `games` (`pool.setBall/setVisible/rack`, `foosball.rods[i].setSlide/setTwist`, `foosball.setBall`, `screen.setMode('off' | 'menu' | 'game')`), `sleep` (`setSleeper(bedId, { color, headTexture } | null)`, `headAnchor(bedId)`, `update(dt)`), `trays` (`setTray(seatId, visible)`, hidden by default) and `islands` (`setIslandName(islandId, name)`).

The loop renders on demand: it idles until something moves, and the shadow map is redrawn only when the camera, size or sun (more than 2 degrees) changes. Lighting is re-evaluated four times a second at most and renders only when it visibly changed.

`bun run check` type-checks; `bun run build` bundles into `dist/`.

`bun run build:public` builds the read-only public page (`public.html`) into `worker/public-dist/` for the Cloudflare relay; see `docs/public-mirror.md` (what it shows, what it leaves out, the office time zone).

## Performance notes

- Main-thread JS is about 2 percent busy with 30 bots; the cost is the software GL raster (swiftshader in headless Chrome, about 150 ms a frame at 1400x800). Real GPUs are not the bottleneck.
- Draw calls in the default preview are about 236 for the full building (walls and furniture are batched per room). The sun's shadow map is 3072 x 3072.
- Render on demand, with a static shadow map redrawn only on camera, size or sun changes; a cached canvas rect (no per-frame layout read); picking throttled to a frame; `contain` on label stacks; character atlases baked at 3 px per unit (about 32 MB for the full set, 15 MB male-only).

## Known limitations

- At the maximum zoom (150 px/m) figures are slightly soft: the atlas is about 106 px/m.
- Two sprite facings only (front, back), mirrored for left and right.
- Label stacks are DOM, so 100+ bots would want pooling or canvas labels.
- The docked chat panel can cover the left corner of the office on narrow windows just above the phone breakpoint.
- Not verified on a real GPU or on a physical phone.
- The dev avatar relay and the settings endpoint answer loopback clients only, so the dev server cannot be used from another machine on the network.
