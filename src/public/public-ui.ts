import type { BotActivity, BotState, OfficeEvent, OfficeFeed, OfficeState } from '../feed/office.types';
import { describeActivity } from '../ui/activity-text';
import type { IdlePlace } from '../office-contracts';
import { el } from '../ui/dom';
import type { Hud } from '../ui/hud';
import type { InstructPopup } from '../ui/instruct-popup';
import type { FeedStatus } from './public-feed';

export interface PublicUi {
  readonly hud: Hud;
  /** Stands in for the private app's instruction popup: selecting a bot only highlights it. */
  readonly popup: InstructPopup;
  setStatus(status: FeedStatus): void;
  setViewers(count: number | null): void;
  /** The relay is full: shows that updates are delayed. */
  setBusy(busy: boolean): void;
  destroy(): void;
}

const ABOUT = 'A live, anonymised view of our AI team at work. Text shown is placeholder.';

/** Coarse, public wording only: no tool names, partners, counts, titles or times. */
function publicActivityText(activity: BotActivity, place: IdlePlace | undefined): string {
  switch (activity.kind) {
    case 'idle':
      return describeActivity(activity, new Map(), place);
    case 'thinking':
    case 'tool':
      return 'Working';
    case 'waiting':
      return 'Waiting';
    case 'meeting':
      return 'In a meeting';
  }
}

interface Row {
  readonly item: HTMLLIElement;
  readonly button: HTMLButtonElement;
  readonly name: HTMLSpanElement;
  readonly activity: HTMLSpanElement;
}

function createRow(bot: BotState, onSelect: (botId: string) => void): Row {
  const item = el('li', 'hud-row');
  const swatch = el('span', 'hud-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  swatch.style.backgroundColor = bot.color;
  const name = el('span', 'hud-name');
  const activity = el('span', 'hud-activity');
  const text = el('span', 'hud-text');
  text.append(name, activity);
  const button = el('button', 'hud-row-button');
  button.type = 'button';
  button.append(swatch, text);
  button.addEventListener('click', () => onSelect(bot.id));
  item.append(button);
  return { item, button, name, activity };
}

const STATE_TEXT: Readonly<Record<FeedStatus, string>> = {
  connecting: 'Connecting...',
  live: 'LIVE',
  paused: 'Paused',
};

const EYE_PATH = 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z';

/** 999 stays as is; 1,234 becomes 1.2k and 12,345 becomes 12k (rounded down so it never overstates). */
export function formatViewerCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${Math.floor(count / 100) / 10}k`;
  return `${Math.floor(count / 1000)}k`;
}

function createEyeIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('pub-eye');
  const outline = document.createElementNS(ns, 'path');
  outline.setAttribute('d', EYE_PATH);
  const pupil = document.createElementNS(ns, 'circle');
  pupil.setAttribute('cx', '8');
  pupil.setAttribute('cy', '8');
  pupil.setAttribute('r', '1.9');
  svg.append(outline, pupil);
  return svg;
}

/** The read-only legend, the footer badge with the About line, and the "feed paused" note. */
export function createPublicUi(overlay: HTMLElement, feed: OfficeFeed): PublicUi {
  const root = el('aside', 'hud');
  root.setAttribute('aria-label', 'Office status');
  const panel = el('div', 'hud-panel');
  const details = el('details', 'hud-details');
  details.open = window.innerWidth > 720;
  const summary = el('summary', 'hud-summary', 'Bots');
  const list = el('ul', 'hud-list');
  details.append(summary, list);
  panel.append(details);
  root.append(panel);

  // Only the state text sits in the live region, so a changing count is never announced.
  const live = el('div', 'pub-live');
  live.dataset.status = 'connecting';
  const dot = el('span', 'pub-dot');
  dot.setAttribute('aria-hidden', 'true');
  const stateText = el('span', 'pub-live-state', STATE_TEXT.connecting);
  stateText.setAttribute('role', 'status');
  stateText.setAttribute('aria-live', 'polite');
  const separator = el('span', 'pub-live-sep', '\u00b7');
  separator.setAttribute('aria-hidden', 'true');
  const watching = el('span', 'pub-live-count');
  watching.setAttribute('role', 'img');
  const watchingNumber = el('span', 'pub-live-number');
  const watchingWord = el('span', 'pub-live-word', 'watching');
  watching.append(createEyeIcon(), watchingNumber, watchingWord);
  separator.hidden = true;
  watching.hidden = true;
  live.append(dot, stateText, separator, watching);

  const footer = el('footer', 'pub-footer');
  const about = el('p', 'pub-about', ABOUT);
  const busyNote = el('p', 'pub-busy', 'Busy: showing delayed updates');
  busyNote.setAttribute('role', 'status');
  busyNote.hidden = true;
  footer.append(busyNote, about);

  overlay.append(live, root, footer);

  const rows = new Map<string, Row>();
  let places: ReadonlyMap<string, IdlePlace> = new Map();
  let state: OfficeState = feed.getState();
  let selectedId: string | null = null;

  const render = (): void => {
    for (const [id, row] of rows) {
      if (state.bots.has(id)) continue;
      row.item.remove();
      rows.delete(id);
      if (selectedId === id) selectedId = null;
    }
    const ordered = [...state.bots.values()].sort((a, b) => a.rank - b.rank);
    ordered.forEach((bot, index) => {
      let row = rows.get(bot.id);
      if (row === undefined) {
        row = createRow(bot, (id) => popup.open(id));
        rows.set(bot.id, row);
      }
      row.name.textContent = bot.name;
      row.activity.textContent = publicActivityText(bot.activity, places.get(bot.id));
      row.button.classList.toggle('is-selected', bot.id === selectedId);
      row.button.setAttribute('aria-pressed', String(bot.id === selectedId));
      if (list.children[index] !== row.item) list.insertBefore(row.item, list.children[index] ?? null);
    });
    summary.textContent = `Bots (${state.bots.size})`;
  };

  const unsubscribe = feed.subscribe((event: OfficeEvent) => {
    if (event.kind !== 'state') return;
    state = event.state;
    render();
  });

  const popup: InstructPopup = {
    get openId() {
      return selectedId;
    },
    open(botId) {
      selectedId = selectedId === botId ? null : botId;
      render();
      if (selectedId !== null) rows.get(selectedId)?.item.scrollIntoView({ block: 'nearest' });
    },
    close() {
      if (selectedId === null) return;
      selectedId = null;
      render();
    },
    destroy() {},
  };

  return {
    hud: {
      setPlaces(next) {
        places = next;
        render();
      },
      hover() {},
      destroy() {},
    },
    popup,
    setStatus(status) {
      stateText.textContent = STATE_TEXT[status];
      live.dataset.status = status;
    },
    setBusy(busy) {
      busyNote.hidden = !busy;
    },
    setViewers(count) {
      separator.hidden = count === null;
      watching.hidden = count === null;
      if (count === null) return;
      watchingNumber.textContent = formatViewerCount(count);
      watching.setAttribute('aria-label', `${count} watching`);
    },
    destroy() {
      unsubscribe();
      root.remove();
      footer.remove();
      live.remove();
    },
  };
}
