import {
  DEFAULT_LIGHTING_MODE,
  DEFAULT_WORKING_HOURS,
  ISLAND_LETTERS,
  LIGHTING_MODES,
  defaultIslandName,
  validateIslandNames,
  validateWorkingHours,
} from '../../shared/office-settings';
import type { IslandLetter, LightingMode, OfficeSettings } from '../../shared/office-settings';
import { ISLAND_NAME_PATTERN } from '../../shared/public-snapshot';
import { el } from './dom';
import type { OfficeSettingsClient } from './office-settings-store';

export interface SettingsDialog {
  open(opener: HTMLElement): void;
  destroy(): void;
}

/** Monday first, as a working week reads; the value is the JS day number (0 = Sunday). */
const DAYS: readonly { readonly day: number; readonly label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

const TIME_FIELDS = [
  { key: 'start', label: 'Day starts' },
  { key: 'end', label: 'Day ends' },
  { key: 'lunchStart', label: 'Lunch starts' },
  { key: 'lunchEnd', label: 'Lunch ends' },
] as const;

const LIGHTING_LABELS: Readonly<Record<LightingMode, string>> = {
  clock: 'Follow the clock',
  day: 'Always day',
  night: 'Always night',
};

const SAVE_FAILED = 'Could not save the settings. Check the connection to the dev server; the change will be retried.';

type TimeKey = (typeof TIME_FIELDS)[number]['key'];

let uid = 0;

function field(label: string, input: HTMLInputElement, className = 'dlg-field'): HTMLElement {
  const id = `dlg-${++uid}`;
  input.id = id;
  const wrap = el('div', className);
  const text = el('label', 'dlg-label', label);
  text.htmlFor = id;
  wrap.append(text, input);
  return wrap;
}

/** A compact modal for the island sign names and the working hours; saved to the shared settings. */
export function createSettingsDialog(overlay: HTMLElement, client: OfficeSettingsClient): SettingsDialog {
  const dialog = el('dialog', 'dlg');
  dialog.setAttribute('aria-labelledby', 'dlg-title');
  const form = el('form', 'dlg-form');
  form.noValidate = true;
  form.method = 'dialog';
  const title = el('h2', 'dlg-title', 'Office settings');
  title.id = 'dlg-title';

  const names = new Map<IslandLetter, HTMLInputElement>();
  const islandSet = el('fieldset', 'dlg-set');
  islandSet.append(el('legend', 'dlg-legend', 'Island names'));
  const islandGrid = el('div', 'dlg-grid');
  for (const letter of ISLAND_LETTERS) {
    const input = el('input', 'dlg-input');
    input.type = 'text';
    input.maxLength = 18;
    input.autocomplete = 'off';
    input.placeholder = defaultIslandName(letter);
    names.set(letter, input);
    islandGrid.append(field(`Island ${letter}`, input));
  }
  islandSet.append(islandGrid);

  const hoursSet = el('fieldset', 'dlg-set');
  hoursSet.append(el('legend', 'dlg-legend', 'Working hours'));
  const enabled = el('input', 'dlg-check');
  enabled.type = 'checkbox';
  const enabledRow = el('div', 'dlg-row');
  const enabledLabel = el('label', 'dlg-check-label');
  enabledLabel.append(enabled, el('span', undefined, 'Follow the schedule (lunch, then bed after hours)'));
  enabledRow.append(enabledLabel);

  const dayRow = el('div', 'dlg-days');
  dayRow.setAttribute('role', 'group');
  dayRow.setAttribute('aria-label', 'Working days');
  const dayInputs = new Map<number, HTMLInputElement>();
  for (const { day, label } of DAYS) {
    const input = el('input', 'dlg-check');
    input.type = 'checkbox';
    dayInputs.set(day, input);
    const chip = el('label', 'dlg-day');
    chip.append(input, el('span', undefined, label));
    dayRow.append(chip);
  }

  const times = new Map<TimeKey, HTMLInputElement>();
  const timeGrid = el('div', 'dlg-grid');
  for (const { key, label } of TIME_FIELDS) {
    const input = el('input', 'dlg-input');
    input.type = 'time';
    input.required = true;
    times.set(key, input);
    timeGrid.append(field(label, input));
  }
  const hint = el('p', 'dlg-hint', 'Local time. The last hour before the end is wind-down. Outside the hours bots go to bed.');
  hoursSet.append(enabledRow, dayRow, timeGrid, hint);

  const lightingSet = el('fieldset', 'dlg-set');
  lightingSet.append(el('legend', 'dlg-legend', 'Lighting'));
  const lighting = el('select', 'dlg-input');
  for (const mode of LIGHTING_MODES) {
    const option = el('option', undefined, LIGHTING_LABELS[mode]);
    option.value = mode;
    lighting.append(option);
  }
  const lightingId = `dlg-${++uid}`;
  lighting.id = lightingId;
  const lightingLabel = el('label', 'dlg-label', 'Scene lighting');
  lightingLabel.htmlFor = lightingId;
  const lightingField = el('div', 'dlg-field');
  lightingField.append(lightingLabel, lighting);
  lightingSet.append(
    lightingField,
    el('p', 'dlg-hint', 'The office follows the sun by the clock: daylight through the windows by day, lamps at night. Applies at once.'),
  );

  const problem = el('p', 'dlg-problem');
  problem.setAttribute('role', 'alert');
  const actions = el('div', 'dlg-actions');
  const cancel = el('button', 'dlg-button', 'Cancel');
  cancel.type = 'button';
  const save = el('button', 'dlg-button dlg-primary', 'Save');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(title, islandSet, hoursSet, lightingSet, problem, actions);
  dialog.append(form);
  overlay.append(dialog);

  let opener: HTMLElement | null = null;

  const fill = (settings: OfficeSettings): void => {
    for (const letter of ISLAND_LETTERS) {
      const input = names.get(letter);
      if (input !== undefined) input.value = settings.islandNames?.[letter] ?? '';
    }
    const hours = settings.workingHours ?? DEFAULT_WORKING_HOURS;
    enabled.checked = hours.enabled;
    for (const [day, input] of dayInputs) input.checked = hours.days.includes(day);
    for (const [key, input] of times) input.value = hours[key];
    lighting.value = settings.lighting?.mode ?? DEFAULT_LIGHTING_MODE;
    setProblem('');
  };

  const setProblem = (text: string, source?: HTMLElement): void => {
    problem.textContent = text;
    for (const input of [...names.values(), ...times.values()]) input.removeAttribute('aria-invalid');
    if (text !== '' && source !== undefined) {
      source.setAttribute('aria-invalid', 'true');
      source.focus();
    }
  };

  lighting.addEventListener('change', () => {
    const mode = LIGHTING_MODES.find((candidate) => candidate === lighting.value) ?? DEFAULT_LIGHTING_MODE;
    void client.update((settings) => ({ ...settings, lighting: { mode } })).then((saved) => {
      if (!saved) setProblem(SAVE_FAILED);
    });
  });

  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    opener?.focus();
    opener = null;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  // Fields are validated live too, so a bad time never waits for Save to be noticed.
  form.addEventListener('input', () => {
    if (problem.textContent !== '') setProblem('');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const entered: Partial<Record<IslandLetter, string>> = {};
    for (const letter of ISLAND_LETTERS) {
      const input = names.get(letter);
      const text = input?.value.trim() ?? '';
      if (input === undefined || text === '') continue;
      if (!ISLAND_NAME_PATTERN.test(text)) {
        setProblem(`Island ${letter}: use 1 to 18 letters, numbers, spaces or . _ ' -`, input);
        return;
      }
      entered[letter] = text;
    }
    const islandNames = validateIslandNames(entered);
    const hours = validateWorkingHours({
      enabled: enabled.checked,
      days: [...dayInputs].filter(([, input]) => input.checked).map(([day]) => day),
      start: times.get('start')?.value ?? '',
      end: times.get('end')?.value ?? '',
      lunchStart: times.get('lunchStart')?.value ?? '',
      lunchEnd: times.get('lunchEnd')?.value ?? '',
    });
    if (!islandNames.ok) {
      setProblem('Check the island names.');
      return;
    }
    if (!hours.ok) {
      const message = hours.error.includes('lunch')
        ? 'Lunch must start and end within the working day, in that order.'
        : hours.error.includes('start must')
          ? 'The day must start before it ends.'
          : 'Enter all four times as hours and minutes.';
      setProblem(message, times.get(hours.error.includes('lunch') ? 'lunchStart' : 'start'));
      return;
    }
    save.disabled = true;
    void client
      .update((settings) => ({ ...settings, islandNames: islandNames.value, workingHours: hours.value }))
      .then((saved) => {
        if (saved) dialog.close();
        else setProblem(SAVE_FAILED);
      })
      .finally(() => {
        save.disabled = false;
      });
  });

  return {
    open(from) {
      opener = from;
      fill(client.get());
      dialog.showModal();
      names.get('A')?.focus();
    },
    destroy() {
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
