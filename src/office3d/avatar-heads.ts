import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';
import type { BotState } from '../feed/office.types';

const SIZE = 128;
/** Pixels darker than this (0..255 luma) belong to the default orb's body. */
const ORB_BODY_LUMA = 70;
/** Crop slightly inside the orb so its anti-aliased rim does not leave a dark edge. */
const ORB_INSET = 0.03;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** The square around the orb's dark body, or null when the image does not look like an orb. */
function orbBox(ctx: CanvasRenderingContext2D, width: number, height: number): Box | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const luma = 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
      if ((data[i + 3] ?? 0) < 128 || luma > ORB_BODY_LUMA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (maxX < 0 || Math.abs(w - h) > Math.max(w, h) * 0.1) return null;
  const size = Math.max(w, h);
  const inset = size * ORB_INSET;
  return { x: minX + inset, y: minY + inset, size: size - inset * 2 };
}

/** Where avatars come from. The private app supplies the daemon's; the public page supplies none. */
export interface AvatarSource {
  /** Same-origin image URL for the bot's avatar, or null when it has none. */
  url(bot: BotState, daemonUrl: string): string | null;
  /** True for the daemon's plain default orb, which is redrawn light-on-dark. */
  isDefaultOrb(bot: BotState): boolean;
}

interface Entry {
  readonly url: string;
  texture: Texture | null;
  loading: boolean;
}

/**
 * Each bot's rendered avatar, fetched once through the same-origin relay and baked into a small
 * canvas texture so the head disc is a clean downscale. One texture per bot, replaced and disposed
 * when the avatar changes, shared by every user of that bot.
 */
export class AvatarHeads {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly source: AvatarSource) {}

  /** The texture to show for the bot right now, or null while loading or when it has no avatar. */
  get(botId: string): Texture | null {
    return this.entries.get(botId)?.texture ?? null;
  }

  /** Starts loading the bot's avatar if it changed; calls `onReady` once the new texture is in place. */
  sync(bot: BotState, daemonUrl: string, onReady: (botId: string) => void): void {
    const url = this.source.url(bot, daemonUrl);
    const entry = this.entries.get(bot.id);
    if (url === null) {
      if (entry !== undefined) this.drop(bot.id, entry);
      return;
    }
    if (entry?.url === url) return;
    if (entry !== undefined) this.drop(bot.id, entry);
    const fresh: Entry = { url, texture: null, loading: true };
    this.entries.set(bot.id, fresh);
    const image = new Image();
    image.onload = () => {
      fresh.loading = false;
      if (this.disposed || this.entries.get(bot.id) !== fresh) return;
      const texture = this.bake(image, this.source.isDefaultOrb(bot));
      if (texture === null) return;
      fresh.texture = texture;
      onReady(bot.id);
    };
    image.onerror = () => {
      fresh.loading = false;
      console.warn(`Avatar for bot ${bot.id} could not be loaded`);
    };
    image.src = url;
  }

  remove(botId: string): void {
    const entry = this.entries.get(botId);
    if (entry !== undefined) this.drop(botId, entry);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.texture?.dispose();
    this.entries.clear();
  }

  private drop(botId: string, entry: Entry): void {
    entry.texture?.dispose();
    this.entries.delete(botId);
  }

  /** Default orbs are shown as in Orbs' own dark theme: a white body with black eyes, filling the head. */
  private bakeOrb(image: HTMLImageElement, ctx: CanvasRenderingContext2D): boolean {
    const source = document.createElement('canvas');
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    const sourceCtx = source.getContext('2d', { willReadFrequently: true });
    if (sourceCtx === null || source.width === 0 || source.height === 0) return false;
    sourceCtx.drawImage(image, 0, 0);
    const box = orbBox(sourceCtx, source.width, source.height);
    if (box === null) return false;
    ctx.filter = 'invert(1)';
    ctx.drawImage(source, box.x, box.y, box.size, box.size, 0, 0, SIZE, SIZE);
    ctx.filter = 'none';
    return true;
  }

  private bake(image: HTMLImageElement, asOrb: boolean): Texture | null {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!asOrb || !this.bakeOrb(image, ctx)) ctx.drawImage(image, 0, 0, SIZE, SIZE);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    return texture;
  }
}
