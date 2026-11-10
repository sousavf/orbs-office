// Entry of the public, read-only page. It must stay free of anything private: no pairing, no oRPC,
// no chat, no settings, no storage. Data comes only from the relay's allow-listed snapshots.
import './public/public.css';
import { createPublicFeed } from './public/public-feed';
import { createPublicSettings } from './public/public-settings';
import { createPublicUi } from './public/public-ui';

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing #${id} container in public.html`);
  return node;
}

function hasWebGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
}

function showFallback(parent: HTMLElement, message: string): void {
  const note = document.createElement('p');
  note.className = 'pub-fallback';
  note.setAttribute('role', 'alert');
  note.textContent = message;
  parent.replaceChildren(note);
}

async function main(): Promise<void> {
  const parent = requireElement('game');
  const overlay = requireElement('overlay');
  if (!hasWebGl()) {
    showFallback(parent, 'Orbs Office needs WebGL to draw the live office, and this browser has it turned off or does not support it.');
    return;
  }
  const feed = createPublicFeed();
  const ui = createPublicUi(overlay, feed);
  feed.onStatus((status) => ui.setStatus(status));
  feed.onViewers((count) => ui.setViewers(count));
  feed.onBusy((busy) => ui.setBusy(busy));
  try {
    const { mountOffice3d } = await import('./office3d/office3d');
    mountOffice3d(parent, {
      feed,
      figures: feed.figures,
      islands: feed.islands,
      // The public page never shows avatars and must not contact a daemon or relay for them.
      avatars: { url: () => null, isDefaultOrb: () => true },
      settings: createPublicSettings(),
      hud: ui.hud,
      popup: ui.popup,
    });
  } catch {
    ui.destroy();
    showFallback(parent, 'The live office could not be drawn on this device.');
    return;
  }
  feed.start();
}

void main();
