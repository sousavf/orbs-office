const FALLBACK_COLOR = 0xa8b0c8;

export function parseColor(hex: string): number {
  return /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : FALLBACK_COLOR;
}

export function mixWithWhite(color: number, amount: number): number {
  const mix = (shift: number): number => {
    const channel = (color >> shift) & 0xff;
    return Math.round(channel + (255 - channel) * amount);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
