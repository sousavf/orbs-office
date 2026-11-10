import type { BubbleKey } from '../actors/types';

const INK = '#1d2127';
const WHITE = '#ffffff';

/** Glyph for each tool family, drawn inside a 40 x 31 bubble body. */
const GLYPHS: Readonly<Record<string, string>> = {
  terminal:
    `<rect x="10" y="8" width="20" height="15" rx="2" fill="${INK}"/>` +
    `<path d="M14 11 18 15.5 14 20M20 20h6" fill="none" stroke="${WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  web:
    `<g fill="none" stroke="${INK}" stroke-width="2"><circle cx="20" cy="15.5" r="8.5"/><ellipse cx="20" cy="15.5" rx="4" ry="8.5"/><path d="M11.5 15.5h17"/></g>`,
  file:
    `<g fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"><path d="M13 7h9l5 5v12H13z"/></g>` +
    `<path d="M16 14h8M16 17.5h8M16 21h6" stroke="${INK}" stroke-width="1.5"/>`,
  mcp:
    `<g fill="${INK}"><rect x="16" y="5" width="3" height="7"/><rect x="22" y="5" width="3" height="7"/><rect x="13" y="11" width="15" height="9" rx="3"/></g>` +
    `<path d="M20.5 20v5" stroke="${INK}" stroke-width="2.5"/>`,
  message:
    `<rect x="10" y="7" width="21" height="14" rx="4" fill="none" stroke="${INK}" stroke-width="2"/>` +
    `<path d="M14 21h5l-5 5z" fill="${INK}"/><g fill="${INK}"><circle cx="16" cy="14" r="1.5"/><circle cx="20.5" cy="14" r="1.5"/><circle cx="25" cy="14" r="1.5"/></g>`,
  other:
    `<path d="M26 15.5h4M10 15.5h4M20 9.5v-4M20 25.5v-4M24.2 11.3l2.8-2.8M13 22.5l2.8-2.8M24.2 19.7l2.8 2.8M13 8.5l2.8 2.8" stroke="${INK}" stroke-width="3.5"/>` +
    `<circle cx="20" cy="15.5" r="7" fill="${INK}"/><circle cx="20" cy="15.5" r="2.8" fill="${WHITE}"/>`,
};

const SHELL =
  `<path d="M10 2h20a8 8 0 0 1 8 8v11a8 8 0 0 1-8 8H25l-5 7-5-7h-5a8 8 0 0 1-8-8V10a8 8 0 0 1 8-8z" fill="${WHITE}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;

const THOUGHT =
  `<g fill="${INK}" stroke="${INK}" stroke-width="3"><circle cx="12" cy="15" r="7"/><circle cx="20" cy="11" r="8"/><circle cx="28" cy="15" r="7"/><circle cx="20" cy="19" r="8"/><circle cx="14" cy="30" r="3.5"/><circle cx="10" cy="35" r="2.5"/></g>` +
  `<g fill="${WHITE}"><circle cx="12" cy="15" r="7"/><circle cx="20" cy="11" r="8"/><circle cx="28" cy="15" r="7"/><circle cx="20" cy="19" r="8"/><circle cx="14" cy="30" r="2.2"/><circle cx="10" cy="35" r="1.4"/></g>` +
  `<g fill="${INK}"><circle cx="14" cy="15" r="1.7"/><circle cx="20" cy="15" r="1.7"/><circle cx="26" cy="15" r="1.7"/></g>`;

function badge(fill: string, mark: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="14" fill="${WHITE}"/>` +
    `<circle cx="15" cy="15" r="12" fill="${fill}"/>${mark}</svg>`
  );
}

const QUESTION = badge(
  '#d9822b',
  `<path d="M10.56 11.3A4.5 4.5 0 1 1 14.3 16.4L15 18.5" fill="none" stroke="${WHITE}" stroke-width="3" stroke-linecap="round"/><circle cx="15" cy="22" r="1.8" fill="${WHITE}"/>`,
);
const ALERT = badge(
  '#d23f45',
  `<rect x="13.3" y="7" width="3.4" height="11" rx="1.5" fill="${WHITE}"/><circle cx="15" cy="22" r="2" fill="${WHITE}"/>`,
);

function bubble(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 38">${body}</svg>`;
}

export interface BubbleImage {
  /** Data URI of an SVG, so each bubble is a single `<img>` node whatever it draws. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

const CACHE = new Map<BubbleKey, BubbleImage>();

function image(svg: string, width: number, height: number): BubbleImage {
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, width, height };
}

/** Vector image for a state bubble; ink colours match the 2D scene so both read alike. */
export function bubbleImage(key: BubbleKey): BubbleImage {
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;
  let made: BubbleImage;
  if (key === 'thought') made = image(bubble(THOUGHT), 34, 32);
  else if (key === 'question') made = image(QUESTION, 26, 26);
  else if (key === 'alert') made = image(ALERT, 26, 26);
  else made = image(bubble(SHELL + (GLYPHS[key] ?? GLYPHS.other ?? '')), 34, 32);
  CACHE.set(key, made);
  return made;
}
/** Plain-language name of a bubble, for assistive text. */
export function bubbleLabel(key: BubbleKey): string {
  switch (key) {
    case 'thought':
      return 'thinking';
    case 'question':
      return 'waiting for approval';
    case 'alert':
      return 'failed';
    case 'message':
      return 'messaging';
    default:
      return `using ${key}`;
  }
}
