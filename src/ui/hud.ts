import type { BotState, OfficeEvent, OfficeFeed, OfficeState } from '../feed/office.types';
import { upcomingRoutines } from '../feed/office-selectors';
import type { IdlePlace, SceneHud } from '../office-contracts';
import { formatOfficeClock } from '../office-clock';
import { describeActivity, formatElapsed } from './activity-text';
import { paintAvatarSwatch } from './avatar-url';
import { createBotMenu } from './bot-menu';
import { el } from './dom';
import type { FigurePrefs } from './figure-prefs';
import type { IslandPrefs } from './island-prefs';
import type { OfficeSettingsClient } from './office-settings-store';
import type { PublicNamePrefs } from './public-name-prefs';
import { createSettingsDialog } from './settings-dialog';

export interface HudDeps {
  readonly figures: FigurePrefs;
  readonly islands: IslandPrefs;
  readonly publicNames: PublicNamePrefs;
  readonly settings: OfficeSettingsClient;
}

export interface Hud extends SceneHud {
  destroy(): void;
}

interface LegendRow {
  readonly item: HTMLLIElement;
  readonly button: HTMLButtonElement;
  readonly swatch: HTMLSpanElement;
  readonly name: HTMLSpanElement;
  readonly activity: HTMLSpanElement;
  readonly publicName: HTMLSpanElement;
}

const TOOLTIP_GAP = 12;
const ROUTINE_LIMIT = 3;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

function createRow(): LegendRow {
  const item = el('li', 'hud-row');
  const swatch = el('span', 'hud-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  const text = el('span', 'hud-text');
  const name = el('span', 'hud-name');
  const activity = el('span', 'hud-activity');
  const publicName = el('span', 'hud-public');
  publicName.hidden = true;
  text.append(name, activity, publicName);
  const button = el('button', 'hud-row-button');
  button.type = 'button';
  button.append(swatch, text);
  item.append(button);
  return { item, button, swatch, name, activity, publicName };
}

/**
 * Row interactions: click selects; right-click, the ContextMenu key, Shift+F10
 * and a touch long-press open the figure menu instead.
 */
function bindRowMenu(
  button: HTMLButtonElement,
  onSelect: (botId: string) => void,
  botId: string,
  openMenu: (x: number, y: number) => void,
): void {
  let pressTimer: number | null = null;
  let pressOrigin = { x: 0, y: 0 };
  let longPressed = false;
  const cancelPress = (): void => {
    if (pressTimer === null) return;
    window.clearTimeout(pressTimer);
    pressTimer = null;
  };

  button.addEventListener('click', () => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    onSelect(botId);
  });
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    cancelPress();
    // Keyboard-triggered contextmenu events carry no pointer position.
    if (event.clientX === 0 && event.clientY === 0) {
      const box = button.getBoundingClientRect();
      openMenu(box.left + 16, box.bottom);
    } else openMenu(event.clientX, event.clientY);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    event.preventDefault();
    const box = button.getBoundingClientRect();
    openMenu(box.left + 16, box.bottom);
  });
  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    longPressed = false;
    pressOrigin = { x: event.clientX, y: event.clientY };
    cancelPress();
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      longPressed = true;
      openMenu(pressOrigin.x, pressOrigin.y);
    }, LONG_PRESS_MS);
  });
  button.addEventListener('pointermove', (event) => {
    if (Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > LONG_PRESS_SLOP) cancelPress();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    button.addEventListener(type, cancelPress);
  }
}

function tooltipLines(bot: BotState, bots: ReadonlyMap<string, BotState>, now: number, place?: IdlePlace): string[] {
  const lines = [describeActivity(bot.activity, bots, place)];
  const run = bot.run;
  if (run === null) return [...lines, 'No active run'];
  lines.push(
    `Run: ${run.title ?? 'Untitled'}`,
    `Trigger: ${run.trigger}`,
    `Running for ${formatElapsed(now - run.startedAt)}`,
    `${run.toolCallCount} tool calls, ${run.tokens.toLocaleString()} tokens`,
  );
  return lines;
}

/** DOM legend, routine list and hover tooltip rendered into the overlay container. */
export function createHud(
  overlay: HTMLElement,
  feed: OfficeFeed,
  onSelect: (botId: string) => void,
  deps: HudDeps,
): Hud {
  const root = el('aside', 'hud');
  root.setAttribute('aria-label', 'Office status');
  const panel = el('div', 'hud-panel');
  const details = el('details', 'hud-details');
  details.open = window.innerWidth > 720;
  const summary = el('summary', 'hud-summary', 'Bots');
  const list = el('ul', 'hud-list');
  const routinesTitle = el('h2', 'hud-title', 'Next routines');
  const routines = el('ul', 'hud-routines');
  details.append(summary, list, routinesTitle, routines);
  const gear = el('button', 'hud-gear');
  gear.type = 'button';
  gear.setAttribute('aria-label', 'Office settings');
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.append(gearIcon());
  panel.append(details, gear);
  root.append(panel);

  const tooltip = el('div', 'hud-tooltip');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  const status = el('p', 'visually-hidden');
  status.setAttribute('role', 'status');
  overlay.append(root, tooltip, status);

  const rows = new Map<string, LegendRow>();
  const botMenu = createBotMenu(overlay, { ...deps, settings: () => deps.settings.get() }, (botId) => rows.get(botId)?.button.focus());
  const settingsDialog = createSettingsDialog(overlay, deps.settings);
  gear.addEventListener('click', () => settingsDialog.open(gear));
  let places: ReadonlyMap<string, IdlePlace> = new Map();
  let state: OfficeState = feed.getState();
  let hoverId: string | null = null;
  let anchor = { x: 0, y: 0 };

  const renderTooltip = (): void => {
    const bot = hoverId === null ? undefined : state.bots.get(hoverId);
    if (bot === undefined) {
      tooltip.hidden = true;
      return;
    }
    const head = el('strong', undefined, bot.name);
    tooltip.replaceChildren(
      head,
      ...tooltipLines(bot, state.bots, Date.now(), places.get(bot.id)).map((line) => el('div', undefined, line)),
    );
    tooltip.hidden = false;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8);
    const top = Math.max(8, anchor.y - height - TOOLTIP_GAP);
    tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const renderLegend = (): void => {
    for (const [id, row] of rows) {
      if (state.bots.has(id)) continue;
      if (botMenu.openId === id) botMenu.close(false);
      row.item.remove();
      rows.delete(id);
    }
    const daemonUrl = state.connection.kind === 'connected' ? state.connection.serverUrl : null;
    const ordered = [...state.bots.values()].sort((a, b) => a.rank - b.rank);
    ordered.forEach((bot, index) => {
      let row = rows.get(bot.id);
      if (row === undefined) {
        row = createRow();
        const id = bot.id;
        row.button.setAttribute('aria-haspopup', 'menu');
        bindRowMenu(row.button, onSelect, id, (x, y) => {
          const name = state.bots.get(id)?.name ?? '';
          botMenu.open(id, name, x, y);
        });
        rows.set(bot.id, row);
      }
      paintAvatarSwatch(row.swatch, bot, daemonUrl);
      row.name.textContent = bot.name;
      row.activity.textContent = describeActivity(bot.activity, state.bots, places.get(bot.id));
      const publicName = deps.publicNames.get(bot.id);
      row.publicName.hidden = publicName === null;
      row.publicName.textContent = publicName === null ? '' : `Public: ${publicName}`;
      // Only move rows that are out of place, so a focused row keeps its focus while the legend refreshes.
      if (list.children[index] !== row.item) list.insertBefore(row.item, list.children[index] ?? null);
    });
    summary.textContent = `Bots (${state.bots.size})`;
    const upcoming = upcomingRoutines(state.bots, ROUTINE_LIMIT);
    routines.replaceChildren(
      ...(upcoming.length > 0
        ? upcoming.map((routine) => el('li', undefined, `${routine.name} - ${formatOfficeClock(routine.at)}`))
        : [el('li', undefined, 'None scheduled')]),
    );
    const empty = state.connection.kind === 'connected' && state.bots.size === 0;
    status.textContent = empty ? 'No bots yet. Create a bot in Orbs.' : '';
  };

  const onEvent = (event: OfficeEvent): void => {
    if (event.kind !== 'state') return;
    state = event.state;
    renderLegend();
    if (hoverId !== null) renderTooltip();
  };

  const unsubscribe = feed.subscribe(onEvent);
  const unsubscribePrefs = deps.publicNames.subscribe(renderLegend);
  const clock = window.setInterval(() => {
    if (hoverId !== null) renderTooltip();
  }, 1000);

  return {
    setPlaces(next) {
      places = next;
      renderLegend();
      if (hoverId !== null) renderTooltip();
    },
    hover(botId, clientX, clientY) {
      const moved = clientX !== anchor.x || clientY !== anchor.y;
      if (botId === hoverId && !moved) return;
      hoverId = botId;
      anchor = { x: clientX, y: clientY };
      renderTooltip();
    },
    destroy() {
      unsubscribe();
      unsubscribePrefs();
      botMenu.destroy();
      settingsDialog.destroy();
      window.clearInterval(clock);
      root.remove();
      tooltip.remove();
      status.remove();
    },
  };
}

function gearIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute(
    'd',
    'M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3c.1.2.4.3.6.2l2.4-1c.5.4 1.1.7 1.7 1l.4 2.5c0 .2.2.4.5.4h3.8c.3 0 .5-.2.5-.4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1c.2.1.5 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  );
  svg.append(path);
  return svg;
}
