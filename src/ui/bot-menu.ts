import { ISLAND_LETTERS, defaultIslandName } from '../../shared/office-settings';
import type { IslandLetter, OfficeSettings } from '../../shared/office-settings';
import { PUBLIC_NAME_PATTERN } from '../../shared/public-snapshot';
import type { PublicIsland } from '../../shared/public-snapshot';
import { el } from './dom';
import type { Figure } from '../office-contracts';
import type { FigurePrefs } from './figure-prefs';
import type { IslandPrefs } from './island-prefs';
import type { PublicNamePrefs } from './public-name-prefs';

const MENU_MARGIN = 8;
const SAVE_FAILED = 'Not saved. It stays on this page and will be retried.';
const PUBLIC_NAME_HINT = "Use 1 to 32 letters, numbers, spaces or . _ ' -";

const FIGURE_CHOICES: readonly { readonly figure: Figure; readonly label: string }[] = [
  { figure: 'male', label: 'Male' },
  { figure: 'female', label: 'Female' },
];

export interface BotMenuDeps {
  readonly figures: FigurePrefs;
  readonly islands: IslandPrefs;
  readonly publicNames: PublicNamePrefs;
  /** The island sign names currently in force. */
  readonly settings: () => OfficeSettings;
}

export interface BotMenu {
  readonly openId: string | null;
  open(botId: string, botName: string, clientX: number, clientY: number): void;
  /** Closes the menu; `restoreFocus` returns focus to the bot's row. */
  close(restoreFocus: boolean): void;
  destroy(): void;
}

interface Choice {
  readonly item: HTMLButtonElement;
}

/** Checks a public name; null when it is fine (empty clears the name). */
export function publicNameProblem(text: string): string | null {
  const name = text.trim();
  if (name === '') return null;
  return PUBLIC_NAME_PATTERN.test(name) ? null : PUBLIC_NAME_HINT;
}

/**
 * The menu behind a legend row: figure, island or solo desk, and an inline editor for the public
 * name. Radio items for the choices, arrow keys to move, Escape to close, focus back on the row.
 */
export function createBotMenu(overlay: HTMLElement, deps: BotMenuDeps, focusRow: (botId: string) => void): BotMenu {
  const menu = el('div', 'hud-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const title = el('div', 'hud-menu-title');
  title.id = 'hud-menu-title';
  menu.setAttribute('aria-labelledby', title.id);
  const choices = el('div', 'hud-menu-choices');
  const saveError = el('p', 'hud-menu-hint hud-menu-error');
  saveError.setAttribute('role', 'alert');
  saveError.hidden = true;
  const editor = el('form', 'hud-menu-editor');
  editor.hidden = true;
  editor.noValidate = true;
  const editorLabel = el('label', 'hud-menu-label', 'Public name');
  editorLabel.htmlFor = 'hud-public-name';
  const input = el('input', 'hud-menu-input');
  input.id = 'hud-public-name';
  input.type = 'text';
  input.maxLength = 32;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const message = el('p', 'hud-menu-hint', 'Shown on the public page. Leave empty to use "Agent NN".');
  message.id = 'hud-public-name-hint';
  message.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', message.id);
  const actions = el('div', 'hud-menu-actions');
  const save = el('button', 'hud-menu-button hud-menu-primary', 'Save');
  save.type = 'submit';
  const cancel = el('button', 'hud-menu-button', 'Cancel');
  cancel.type = 'button';
  actions.append(save, cancel);
  editor.append(editorLabel, input, message, actions);
  menu.append(title, choices, saveError, editor);
  overlay.append(menu);

  let openId: string | null = null;
  let items: Choice[] = [];
  let anchor = { x: 0, y: 0 };

  const place = (): void => {
    const left = Math.min(Math.max(MENU_MARGIN, anchor.x), window.innerWidth - menu.offsetWidth - MENU_MARGIN);
    const top = Math.min(Math.max(MENU_MARGIN, anchor.y), window.innerHeight - menu.offsetHeight - MENU_MARGIN);
    menu.style.transform = `translate(${Math.round(Math.max(MENU_MARGIN, left))}px, ${Math.round(Math.max(MENU_MARGIN, top))}px)`;
  };

  const close = (restoreFocus: boolean): void => {
    if (openId === null) return;
    const id = openId;
    openId = null;
    menu.hidden = true;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onResize);
    if (restoreFocus) focusRow(id);
  };
  const onOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    close(true);
  };
  const onResize = (): void => close(false);

  const focusItem = (index: number): void => {
    const count = items.length;
    if (count > 0) items[((index % count) + count) % count]?.item.focus();
  };
  const focusedIndex = (): number => items.findIndex(({ item }) => item === document.activeElement);

  /** Closes once the choice is saved; otherwise keeps the menu open with the choice marked as not saved. */
  const persist = async (botId: string, saving: Promise<boolean>): Promise<void> => {
    const saved = await saving;
    if (openId !== botId) return;
    if (saved) {
      close(true);
      return;
    }
    if (editor.hidden) showChoices(botId);
    saveError.textContent = SAVE_FAILED;
    saveError.hidden = false;
    place();
  };

  const radio = (parent: HTMLElement, label: string, checked: boolean, choose: () => void): void => {
    const item = el('button', 'hud-menu-item');
    item.type = 'button';
    item.tabIndex = -1;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(checked));
    const check = el('span', 'hud-menu-check', '✓');
    check.setAttribute('aria-hidden', 'true');
    item.append(check, el('span', 'hud-menu-text', label));
    item.addEventListener('click', choose);
    parent.append(item);
    items.push({ item });
  };

  const group = (name: string): HTMLElement => {
    const section = el('div', 'hud-menu-group');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', name);
    const heading = el('div', 'hud-menu-heading', name);
    heading.setAttribute('aria-hidden', 'true');
    section.append(heading);
    choices.append(section);
    return section;
  };

  const showChoices = (botId: string): void => {
    choices.replaceChildren();
    items = [];
    saveError.hidden = true;
    editor.hidden = true;
    choices.hidden = false;
    const figure = deps.figures.get(botId);
    const figures = group('Figure');
    for (const choice of FIGURE_CHOICES) {
      radio(figures, choice.label, choice.figure === figure, () => {
        void persist(botId, deps.figures.set(botId, choice.figure));
      });
    }
    const island = deps.islands.get(botId);
    const names = deps.settings().islandNames ?? {};
    const islands = group('Island');
    const pick = (value: PublicIsland) => (): void => {
      void persist(botId, deps.islands.set(botId, value));
    };
    radio(islands, 'Automatic', island === 'auto', pick('auto'));
    for (const letter of ISLAND_LETTERS) {
      radio(islands, names[letter] ?? defaultIslandName(letter), island === letter, pick(letter satisfies IslandLetter));
    }
    radio(islands, 'Solo desk', island === 'solo', pick('solo'));
    const rule = el('div', 'hud-menu-rule');
    rule.setAttribute('role', 'separator');
    const rename = el('button', 'hud-menu-item');
    rename.type = 'button';
    rename.tabIndex = -1;
    rename.setAttribute('role', 'menuitem');
    rename.append(el('span', 'hud-menu-check'), el('span', 'hud-menu-text', 'Public name…'));
    rename.addEventListener('click', () => showEditor(botId));
    choices.append(rule, rename);
    items.push({ item: rename });
  };

  const showEditor = (botId: string): void => {
    choices.hidden = true;
    editor.hidden = false;
    items = [];
    input.value = deps.publicNames.get(botId) ?? '';
    input.removeAttribute('aria-invalid');
    message.textContent = 'Shown on the public page. Leave empty to use "Agent NN".';
    message.classList.remove('hud-menu-error');
    place();
    input.focus();
    input.select();
  };

  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (openId === null) return;
    const problem = publicNameProblem(input.value);
    if (problem !== null) {
      input.setAttribute('aria-invalid', 'true');
      message.textContent = problem;
      message.classList.add('hud-menu-error');
      input.focus();
      return;
    }
    const name = input.value.trim();
    void persist(openId, deps.publicNames.set(openId, name === '' ? null : name));
  });
  cancel.addEventListener('click', () => close(true));
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === null) return;
    input.removeAttribute('aria-invalid');
    message.textContent = 'Shown on the public page. Leave empty to use "Agent NN".';
    message.classList.remove('hud-menu-error');
  });

  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!editor.hidden) {
      if (event.key === 'Tab') event.stopPropagation();
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        focusItem(focusedIndex() + 1);
        break;
      case 'ArrowUp':
        focusItem(focusedIndex() - 1);
        break;
      case 'Home':
        focusItem(0);
        break;
      case 'End':
        focusItem(items.length - 1);
        break;
      case 'Tab':
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  menu.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    get openId() {
      return openId;
    },
    open(botId, botName, clientX, clientY) {
      openId = botId;
      anchor = { x: clientX, y: clientY };
      title.textContent = botName;
      showChoices(botId);
      menu.hidden = false;
      place();
      document.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('resize', onResize);
      const checked = items.findIndex(({ item }) => item.getAttribute('aria-checked') === 'true');
      focusItem(Math.max(0, checked));
    },
    close,
    destroy() {
      close(false);
      menu.remove();
    },
  };
}
