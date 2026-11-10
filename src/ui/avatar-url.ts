import type { BotState } from '../feed/office.types';

/** Changes whenever the avatar definition changes, so a cached image is not reused after an edit. */
function avatarVersion(bot: BotState): string {
  return encodeURIComponent(JSON.stringify(bot.avatar ?? null));
}

/**
 * The daemon's rendered avatar (orb or uploaded image) through the dev server's same-origin relay,
 * so WebGL can use it as a texture and the legend shares the same cached image.
 */
export function avatarTextureUrl(daemonUrl: string, bot: BotState): string | null {
  if (URL.parse(daemonUrl) === null) return null;
  const query = new URLSearchParams({ daemon: daemonUrl, bot: bot.id, v: avatarVersion(bot) });
  return `/avatar-relay?${query.toString()}`;
}

/** The daemon renders the default orb as a dark body with light eyes on a pale disc. */
export function isDefaultOrb(bot: BotState): boolean {
  return bot.avatar === null || (bot.avatar.kind === 'blob' && bot.avatar.color === 'ink');
}

/**
 * Shows a bot's avatar in a round DOM swatch. Default orbs are drawn as in Orbs' dark theme
 * (white body, black eyes) through the `is-orb` style; every other avatar is shown as rendered.
 */
export function paintAvatarSwatch(swatch: HTMLElement, bot: BotState, daemonUrl: string | null): void {
  const url = daemonUrl === null ? null : avatarTextureUrl(daemonUrl, bot);
  const asOrb = url !== null && isDefaultOrb(bot);
  swatch.classList.toggle('is-orb', asOrb);
  swatch.style.backgroundColor = bot.color;
  swatch.style.backgroundImage = url === null || asOrb ? '' : `url("${url}")`;
  if (asOrb) swatch.style.setProperty('--avatar', `url("${url}")`);
  else swatch.style.removeProperty('--avatar');
}
