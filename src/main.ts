import { mountConnectionPanel } from './connection/connection-panel';
import { createOfficeFeed } from './feed/office-feed';
import type { ChatControl, OfficeFeed } from './feed/office.types';
import { avatarTextureUrl, isDefaultOrb } from './ui/avatar-url';
import { createFigurePrefs } from './ui/figure-prefs';
import { createHud } from './ui/hud';
import { createIslandPrefs } from './ui/island-prefs';
import { getOfficeSettingsClient } from './ui/office-settings-store';
import { createPublicNamePrefs } from './ui/public-name-prefs';
import { createInstructPopup } from './ui/instruct-popup';

function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing #${id} container in index.html`);
  return node;
}

/** `?preview` swaps in a scripted fake feed so the visuals can be checked without a daemon. */
async function createFeed(overlay: HTMLElement): Promise<OfficeFeed & ChatControl> {
  if (new URLSearchParams(window.location.search).has('preview')) {
    const { createPreviewFeed } = await import('./ui/preview-feed');
    return createPreviewFeed();
  }
  const feed = createOfficeFeed();
  mountConnectionPanel(overlay, feed);
  return feed;
}

async function main(): Promise<void> {
  // Footage mode (`?preview&record`) swaps every time source for a virtual clock before anything reads one.
  const params = new URLSearchParams(window.location.search);
  const recording = params.has('preview') && params.has('record');
  if (recording) await import('./office3d/dev/record-time');
  const parent = requireElement('game');
  const overlay = requireElement('overlay');
  const feed = await createFeed(overlay);
  const popup = createInstructPopup(overlay, feed, feed);
  const figures = createFigurePrefs();
  const islands = createIslandPrefs();
  const publicNames = createPublicNamePrefs();
  if (recording) Object.assign(window, { __previewFigures: figures });
  const settings = getOfficeSettingsClient();
  const hud = createHud(overlay, feed, (botId) => popup.open(botId), { figures, islands, publicNames, settings });

  const { mountOffice3d } = await import('./office3d/office3d');
  mountOffice3d(parent, {
    feed,
    figures,
    islands,
    avatars: { url: (bot, daemonUrl) => avatarTextureUrl(daemonUrl, bot), isDefaultOrb },
    settings,
    hud,
    popup,
  });
}

void main();
