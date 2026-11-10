import { SendError } from '../feed/office-feed';
import type { BotState, ChatControl, ChatLine, OfficeEvent, OfficeFeed, OfficeState } from '../feed/office.types';
import { describeActivity } from './activity-text';
import { paintAvatarSwatch } from './avatar-url';
import { renderMarkdown } from './markdown';

export interface InstructPopup {
  /** Bot whose popup is open, or null. */
  readonly openId: string | null;
  open(botId: string): void;
  /** `restoreFocus` is false when the user has already moved focus by pressing elsewhere. */
  close(restoreFocus?: boolean): void;
  destroy(): void;
}

const MAX_LENGTH = 64_000;
const SENT_MS = 2500;
const REFETCH_MS = 500;
const STICK_PX = 24;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Click-a-bot dialog: current status, the latest chat message and a box to message the bot. */
export function createInstructPopup(
  overlay: HTMLElement,
  feed: OfficeFeed,
  chat: ChatControl,
): InstructPopup {
  const root = el('div', 'popup');
  root.setAttribute('role', 'dialog');
  root.hidden = true;

  const avatar = el('span', 'popup-avatar');
  avatar.setAttribute('aria-hidden', 'true');
  const title = el('h2', 'popup-title');
  title.id = 'popup-title';
  root.setAttribute('aria-labelledby', title.id);
  const activity = el('p', 'popup-activity');
  const heading = el('div', 'popup-heading');
  heading.append(title, activity);
  const close = el('button', 'popup-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  const header = el('header', 'popup-header');
  header.append(avatar, heading, close);

  const log = el('div', 'popup-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Recent messages');
  log.tabIndex = 0;
  const logNote = el('p', 'popup-log-note');
  const retry = el('button', 'popup-retry', 'Retry');
  retry.type = 'button';
  retry.hidden = true;

  const form = el('form', 'popup-form');
  const label = el('label', 'popup-label');
  label.htmlFor = 'popup-message';
  const field = el('textarea', 'popup-field');
  field.id = 'popup-message';
  field.rows = 3;
  field.maxLength = MAX_LENGTH;
  field.setAttribute('aria-describedby', 'popup-error');
  const error = el('p', 'popup-error');
  error.id = 'popup-error';
  error.setAttribute('role', 'alert');
  const sent = el('p', 'popup-sent', 'Sent');
  sent.setAttribute('role', 'status');
  const send = el('button', 'popup-send', 'Send');
  send.type = 'submit';
  const actions = el('div', 'popup-actions');
  actions.append(sent, send);
  form.append(label, field, error, actions);

  root.append(header, log, logNote, retry, form);
  overlay.append(root);

  let returnFocus: HTMLElement | null = null;
  const drafts = new Map<string, string>();
  const histories = new Map<string, ChatLine[]>();
  let refetchTimer: number | null = null;
  let loaded = false;
  let loadFailed = false;
  let logKey = '';
  let state: OfficeState = feed.getState();
  let openId: string | null = null;
  let busy = false;
  let sentTimer: number | null = null;

  const bot = (): BotState | undefined => (openId === null ? undefined : state.bots.get(openId));

  const setError = (message: string): void => {
    error.textContent = message;
    field.toggleAttribute('aria-invalid', message !== '');
  };

  const setSent = (visible: boolean): void => {
    if (sentTimer !== null) window.clearTimeout(sentTimer);
    sentTimer = null;
    sent.classList.toggle('popup-sent-on', visible);
    if (visible) sentTimer = window.setTimeout(() => setSent(false), SENT_MS);
  };

  const setBusy = (value: boolean): void => {
    busy = value;
    field.disabled = value;
    send.disabled = value;
    send.textContent = value ? 'Sending...' : 'Send';
  };

  const render = (): void => {
    const current = bot();
    if (current === undefined) {
      if (openId !== null) api.close();
      return;
    }
    title.textContent = current.name;
    label.textContent = `Message ${current.name}`;
    activity.textContent = describeActivity(current.activity, state.bots);
    const daemonUrl = state.connection.kind === 'connected' ? state.connection.serverUrl : null;
    paintAvatarSwatch(avatar, current, daemonUrl);
    renderLog(current);
  };

  const renderLog = (current: BotState): void => {
    const lines = histories.get(current.id) ?? [];
    const now = Date.now();
    const key = [current.id, current.name, loaded, loadFailed, ...lines.map((line) => `${line.id}${line.at > 0 ? formatAgo(now - line.at) : ''}`)].join('|');
    if (key === logKey) return;
    logKey = key;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;
    log.replaceChildren(
      ...lines.map((line) => {
        const row = el('div', line.role === 'user' ? 'popup-line popup-line-user' : 'popup-line');
        const meta = el('div', 'popup-line-meta');
        meta.append(
          el('strong', undefined, line.role === 'user' ? 'You' : current.name),
          line.at > 0 ? el('span', undefined, formatAgo(now - line.at)) : '',
        );
        const body = el('div', line.role === 'user' ? 'popup-line-text' : 'popup-line-text popup-md');
        if (line.role === 'user') body.textContent = line.text;
        else body.append(renderMarkdown(line.text));
        row.append(meta, body);
        return row;
      }),
    );
    if (loadFailed) {
      logNote.textContent = 'Could not load the conversation.';
    } else if (!loaded && lines.length === 0) {
      logNote.textContent = 'Loading...';
    } else if (lines.length === 0) {
      logNote.textContent = 'No messages yet.';
    } else {
      logNote.textContent = '';
    }
    retry.hidden = !loadFailed;
    logNote.hidden = logNote.textContent === '';
    if (stick) log.scrollTop = log.scrollHeight;
  };

  const loadHistory = async (): Promise<void> => {
    const target = openId;
    if (target === null) return;
    try {
      const lines = await chat.history(target);
      histories.set(target, lines);
      loadFailed = false;
    } catch (failure) {
      loadFailed = true;
      logNote.textContent = failure instanceof SendError ? failure.message : 'Could not load the conversation.';
    }
    if (openId !== target) return;
    loaded = true;
    const current = bot();
    if (current !== undefined) renderLog(current);
    if (loadFailed) {
      logNote.hidden = false;
      retry.hidden = false;
    }
  };

  const scheduleRefetch = (): void => {
    if (refetchTimer !== null) window.clearTimeout(refetchTimer);
    refetchTimer = window.setTimeout(() => {
      refetchTimer = null;
      void loadHistory();
    }, REFETCH_MS);
  };

  const submit = async (): Promise<void> => {
    const target = openId;
    if (target === null || busy) return;
    const text = field.value.trim();
    if (text === '') {
      setError('Type a message first.');
      field.focus();
      return;
    }
    setError('');
    setSent(false);
    setBusy(true);
    try {
      await chat.send(target, text);
      drafts.delete(target);
      if (openId === target) scheduleRefetch();
      if (openId === target) {
        field.value = '';
        setSent(true);
      }
    } catch (failure) {
      if (openId === target) {
        setError(failure instanceof SendError ? failure.message : 'Could not send the message.');
      }
    } finally {
      setBusy(false);
      if (openId === target) field.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && openId !== null) {
      event.preventDefault();
      api.close();
    }
  };

  /**
   * A press anywhere outside the dialog closes it, as soon as the pointer goes down (so a camera drag
   * that starts outside also closes it). Legend rows are left alone: their click opens that bot's popup.
   */
  const onOutsidePress = (event: PointerEvent): void => {
    if (openId === null || !(event.target instanceof Node)) return;
    if (root.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest('.hud-row-button') !== null) return;
    api.close(false);
  };

  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  field.addEventListener('input', () => {
    if (openId !== null) drafts.set(openId, field.value);
    if (error.textContent !== '') setError('');
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  close.addEventListener('click', () => api.close());
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onOutsidePress, true);

  retry.addEventListener('click', () => {
    loadFailed = false;
    loaded = false;
    const current = bot();
    if (current !== undefined) renderLog(current);
    void loadHistory();
  });

  const unsubscribe = feed.subscribe((event: OfficeEvent) => {
    if (event.kind === 'state') {
      state = event.state;
      if (openId !== null) render();
    } else if ((event.kind === 'reply' || event.kind === 'mail') && event.botId === openId) {
      scheduleRefetch();
    }
  });
  const clock = window.setInterval(() => {
    if (openId !== null) render();
  }, 1000);

  const api: InstructPopup = {
    get openId() {
      return openId;
    },
    open(botId) {
      if (openId === botId) {
        field.focus();
        return;
      }
      if (openId !== null) drafts.set(openId, field.value);
      else {
        const active = document.activeElement;
        returnFocus = active instanceof HTMLElement && !root.contains(active) ? active : null;
      }
      openId = botId;
      field.value = drafts.get(botId) ?? '';
      setError('');
      setSent(false);
      root.hidden = false;
      logKey = '';
      loaded = histories.has(botId);
      loadFailed = false;
      render();
      log.scrollTop = log.scrollHeight;
      field.focus();
      void loadHistory();
    },
    close(restoreFocus = true) {
      if (openId === null) return;
      drafts.set(openId, field.value);
      openId = null;
      if (refetchTimer !== null) window.clearTimeout(refetchTimer);
      refetchTimer = null;
      root.hidden = true;
      setError('');
      setSent(false);
      const target = returnFocus;
      returnFocus = null;
      if (!restoreFocus) return;
      if (target !== null && target.isConnected && target !== document.body) {
        target.focus({ preventScroll: true });
        return;
      }
      const canvas = document.querySelector<HTMLCanvasElement>('#game canvas');
      if (canvas !== null) {
        canvas.tabIndex = -1;
        canvas.focus({ preventScroll: true });
      }
    },
    destroy() {
      unsubscribe();
      window.clearInterval(clock);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutsidePress, true);
      if (sentTimer !== null) window.clearTimeout(sentTimer);
      if (refetchTimer !== null) window.clearTimeout(refetchTimer);
      root.remove();
    },
  };
  return api;
}
