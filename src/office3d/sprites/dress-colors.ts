const FALLBACK_HUE_STEP = 137;
const ACCENT_HUE_SHIFT = 165;
/** Muted so the sash and collar read as trim next to the dress, not as a second dress. */
const ACCENT_SATURATION = 0.34;
const ACCENT_LIGHTNESS = 0.6;

export interface DressColors {
  readonly dress: number;
  readonly accent: number;
}

/** Stable 32-bit hash of a bot id (FNV-1a); picks the dress pattern and the hue for colourless bots. */
export function dressSeed(botId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < botId.length; i += 1) {
    hash = Math.imul(hash ^ botId.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

function toHsl(color: number): { h: number; s: number; l: number } {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function fromHsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor((((h % 360) + 360) % 360) / 60);
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] ?? [c, x, 0];
  const channel = (v: number): number => Math.round((v + m) * 255);
  return (channel(r ?? 0) << 16) | (channel(g ?? 0) << 8) | channel(b ?? 0);
}

/**
 * Tints for the dress and its accent. Very dark or grey bot colours are lifted
 * into a saturated colour (hue from the seed when there is none), and the accent
 * sits about 165 degrees around the wheel from the dress.
 */
export function dressColors(botColor: number, seed: number): DressColors {
  const { h, s, l } = toHsl(botColor);
  const hue = s < 0.18 ? (seed * FALLBACK_HUE_STEP) % 360 : h;
  const dress = fromHsl(hue, Math.max(s, 0.62), Math.min(Math.max(l, 0.58), 0.7));
  return { dress, accent: fromHsl(hue + ACCENT_HUE_SHIFT, ACCENT_SATURATION, ACCENT_LIGHTNESS) };
}
