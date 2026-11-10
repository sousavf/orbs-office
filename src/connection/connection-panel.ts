import type { ConnectionStatus, ConnectionControl } from '../feed/office.types';

const DEFAULT_DAEMON_URL = 'http://localhost:47191';

const CSS = `
.oo-panel {
  --oo-bg: #ffffff; --oo-fg: #1a1a1f; --oo-muted: #54545e; --oo-border: #c9c9d1;
  --oo-accent: #5b3fd9; --oo-accent-fg: #ffffff; --oo-error: #b3261e; --oo-focus: #1a5fd1;
  font: 14px/1.45 system-ui, sans-serif; color: var(--oo-fg); box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  .oo-panel {
    --oo-bg: #1c1c22; --oo-fg: #f2f2f5; --oo-muted: #b4b4c0; --oo-border: #4a4a55;
    --oo-accent: #a794ff; --oo-accent-fg: #14141a; --oo-error: #ff8a80; --oo-focus: #8ab4ff;
  }
}
.oo-panel *, .oo-panel *::before, .oo-panel *::after { box-sizing: border-box; }
.oo-card, .oo-banner, .oo-status, .oo-chip {
  position: fixed; z-index: 10; background: var(--oo-bg); color: var(--oo-fg);
  border: 1px solid var(--oo-border); border-radius: 10px;
}
.oo-card { top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(92vw, 380px); padding: 20px; }
.oo-card h2 { margin: 0 0 8px; font-size: 18px; }
.oo-card p { margin: 0 0 14px; color: var(--oo-muted); }
.oo-field { display: block; margin-bottom: 12px; }
.oo-field span { display: block; margin-bottom: 4px; font-weight: 600; }
.oo-field input {
  width: 100%; padding: 8px 10px; font: inherit; color: var(--oo-fg); background: var(--oo-bg);
  border: 1px solid var(--oo-border); border-radius: 6px;
}
.oo-field input[aria-invalid="true"] { border-color: var(--oo-error); }
.oo-error { margin: 0 0 12px; color: var(--oo-error); font-weight: 600; }
.oo-panel button {
  font: inherit; padding: 8px 14px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--oo-border); background: var(--oo-bg); color: var(--oo-fg);
}
.oo-panel button.oo-primary { background: var(--oo-accent); color: var(--oo-accent-fg); border-color: var(--oo-accent); font-weight: 600; }
.oo-panel button:disabled { opacity: 0.6; cursor: progress; }
.oo-panel :is(button, input, code):focus-visible { outline: 3px solid var(--oo-focus); outline-offset: 2px; }
.oo-panel code { padding: 1px 4px; border-radius: 4px; border: 1px solid var(--oo-border); }
.oo-banner { top: 12px; left: 50%; transform: translateX(-50%); width: min(92vw, 520px); padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-color: var(--oo-error); }
.oo-banner p { margin: 0; flex: 1 1 200px; }
.oo-status { top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 12px; }
.oo-chip { top: 12px; left: 12px; max-width: min(360px, calc(100vw - 24px)); padding: 4px 4px 4px 12px; display: flex; gap: 8px; align-items: center; }
.oo-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.oo-chip button { padding: 4px 10px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = el('button', { type: 'button', textContent: label, className: primary ? 'oo-primary' : '' });
  node.addEventListener('click', onClick);
  return node;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'Pairing failed. Try again.';
}

export function mountConnectionPanel(container: HTMLElement, feed: ConnectionControl): () => void {
  const style = el('style', { textContent: CSS });
  const root = el('div', { className: 'oo-panel' });
  container.append(style, root);

  let formError = '';
  let isPairing = false;
  let draftUrl = DEFAULT_DAEMON_URL;
  let lastKind: ConnectionStatus['kind'] | null = null;

  function renderForm(): HTMLElement {
    const urlInput = el('input', { id: 'oo-daemon-url', type: 'url', name: 'daemonUrl', value: draftUrl, required: true, autocomplete: 'off' });
    const pinInput = el('input', {
      id: 'oo-pin', type: 'text', name: 'pin', inputMode: 'numeric', autocomplete: 'one-time-code',
      maxLength: 6, pattern: '[0-9]{6}', required: true,
    });
    const errorNode = el('p', { id: 'oo-pair-error', className: 'oo-error', textContent: formError, hidden: formError === '' });
    errorNode.setAttribute('role', 'alert');
    for (const input of [urlInput, pinInput]) {
      input.setAttribute('aria-describedby', 'oo-pair-error');
      input.setAttribute('aria-invalid', String(formError !== ''));
    }
    const submit = el('button', { type: 'submit', className: 'oo-primary', textContent: isPairing ? 'Pairing...' : 'Pair', disabled: isPairing });
    const form = el(
      'form',
      { noValidate: true },
      el('h2', { textContent: 'Pair with Orbs' }),
      el('p', {}, 'Run ', el('code', { textContent: 'bun run dev:pair' }), ' (or ', el('code', { textContent: 'orbs pair' }), ') in Orbs to get a PIN.'),
      el('label', { className: 'oo-field' }, el('span', { textContent: 'Daemon URL' }), urlInput),
      el('label', { className: 'oo-field' }, el('span', { textContent: '6-digit PIN' }), pinInput),
      errorNode,
      submit,
    );
    urlInput.addEventListener('input', () => {
      draftUrl = urlInput.value;
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isPairing) return;
      draftUrl = urlInput.value;
      isPairing = true;
      formError = '';
      render();
      feed.pair(draftUrl, pinInput.value).catch((error: unknown) => {
        formError = errorMessage(error);
      }).finally(() => {
        isPairing = false;
        if (formError === '') return;
        render();
        root.querySelector<HTMLInputElement>('#oo-pin')?.focus();
      });
    });
    return el('div', { className: 'oo-card' }, form);
  }

  function render(): void {
    const status = feed.getState().connection;
    // Rebuilding the form on every state event would drop typed PIN digits and focus.
    if (status.kind === 'unpaired' && lastKind === 'unpaired' && !isPairing && formError === '') return;
    lastKind = status.kind;
    root.replaceChildren();

    switch (status.kind) {
      case 'unpaired':
        root.append(renderForm());
        root.querySelector<HTMLInputElement>('#oo-pin')?.focus();
        break;
      case 'connecting':
        root.append(el('div', { className: 'oo-status', role: 'status', textContent: 'Connecting to Orbs...' }));
        break;
      case 'error':
        root.append(el(
          'div',
          { className: 'oo-banner', role: 'alert' },
          el('p', { textContent: status.message }),
          button('Retry', () => feed.retry(), true),
          button('Pair again', () => feed.forget()),
        ));
        break;
      case 'connected':
        root.append(el(
          'div',
          { className: 'oo-chip' },
          el('span', { textContent: status.serverUrl, title: status.serverUrl }),
          button('Disconnect', () => feed.forget()),
        ));
        break;
    }
  }

  const unsubscribe = feed.subscribe((event) => {
    if (event.kind === 'state') render();
  });

  return () => {
    unsubscribe();
    style.remove();
    root.remove();
  };
}
