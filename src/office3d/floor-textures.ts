import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import type { ZoneId } from './layout.types';
import type { ZoneStyle } from './palette';
import { seeded } from './props/kit';

/** Pixels per metre in the generated floor textures. */
const PX = 128;
/** Texture tile edge in metres. */
export const TILE_M = 2;

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function jitter(color: number, amount: number, rand: () => number): string {
  const d = (rand() - 0.5) * 2 * amount;
  const ch = (shift: number): number => Math.min(255, Math.max(0, Math.round(((color >> shift) & 0xff) + d)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

type Painter = (ctx: CanvasRenderingContext2D, size: number, style: ZoneStyle, rand: () => number) => void;

const planks: Painter = (ctx, size, style, rand) => {
  ctx.fillStyle = css(style.top);
  ctx.fillRect(0, 0, size, size);
  const plankH = PX * 0.25;
  const rows = size / plankH;
  for (let row = 0; row < rows; row++) {
    const y = row * plankH;
    let x = -rand() * PX * 0.9;
    while (x < size) {
      const len = PX * (0.9 + rand() * 0.9);
      ctx.fillStyle = jitter(style.top, 9, rand);
      ctx.fillRect(x, y, len, plankH);
      ctx.fillStyle = css(style.mark);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x + len - 2, y, 2, plankH);
      ctx.globalAlpha = 0.18;
      for (let g = 0; g < 3; g++) ctx.fillRect(x + rand() * len, y + rand() * plankH, 8 + rand() * 24, 1);
      ctx.globalAlpha = 1;
      x += len;
    }
    ctx.fillStyle = css(style.mark);
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, y, size, 2);
    ctx.globalAlpha = 1;
  }
};

const terrazzo: Painter = (ctx, size, style, rand) => {
  ctx.fillStyle = css(style.top);
  ctx.fillRect(0, 0, size, size);
  const tints = [style.mark, 0xffffff, 0x8a7e72, 0xd9a58a, 0x9bb3ae];
  for (let i = 0; i < 520; i++) {
    ctx.fillStyle = css(tints[Math.floor(rand() * tints.length)] ?? style.mark);
    ctx.globalAlpha = 0.35 + rand() * 0.4;
    const r = 1 + rand() * 3.2;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, r, r * (0.5 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = css(style.mark);
  for (let i = 0; i <= size; i += PX) {
    ctx.fillRect(i, 0, 2, size);
    ctx.fillRect(0, i, size, 2);
  }
  ctx.globalAlpha = 1;
};

const checker: Painter = (ctx, size, style) => {
  const tile = PX * 0.5;
  for (let y = 0; y < size / tile; y++) {
    for (let x = 0; x < size / tile; x++) {
      ctx.fillStyle = css((x + y) % 2 === 0 ? style.top : style.mark);
      ctx.fillRect(x * tile, y * tile, tile, tile);
    }
  }
  ctx.fillStyle = 'rgba(70,40,30,0.28)';
  for (let i = 0; i <= size; i += tile) {
    ctx.fillRect(i - 1, 0, 2, size);
    ctx.fillRect(0, i - 1, size, 2);
  }
};

const carpet: Painter = (ctx, size, style, rand) => {
  ctx.fillStyle = css(style.top);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = jitter(rand() < 0.5 ? style.top : style.mark, 14, rand);
    ctx.globalAlpha = 0.35;
    ctx.fillRect(rand() * size, rand() * size, 2, 2);
  }
  ctx.globalAlpha = 1;
};

const kraft: Painter = (ctx, size, style, rand) => {
  ctx.fillStyle = css(style.top);
  ctx.fillRect(0, 0, size, size);
  const board = PX * 0.5;
  for (let y = 0; y < size / board; y++) {
    for (let x = 0; x < size / board; x++) {
      ctx.fillStyle = jitter(style.top, 7, rand);
      ctx.fillRect(x * board, y * board, board, board);
    }
  }
  ctx.fillStyle = css(style.mark);
  ctx.globalAlpha = 0.4;
  for (let i = 0; i <= size; i += board) {
    ctx.fillRect(i - 1, 0, 2, size);
    ctx.fillRect(0, i - 1, size, 2);
  }
  for (let i = 0; i < 400; i++) ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 6, 1);
  ctx.globalAlpha = 1;
};

const PAINTERS: Readonly<Record<ZoneId, Painter>> = {
  workspace: planks,
  corridor: terrazzo,
  kitchen: checker,
  mailroom: kraft,
  approvals: carpet,
  'meeting-a': carpet,
  'meeting-b': carpet,
  hall: terrazzo,
  dormitory: carpet,
  games: carpet,
};

const SEEDS: Readonly<Record<ZoneId, number>> = {
  workspace: 11, corridor: 23, kitchen: 5, mailroom: 41, approvals: 59, 'meeting-a': 73, 'meeting-b': 89,
  hall: 29, dormitory: 97, games: 101,
};

/** Paints a tileable floor texture for a zone; callers set `repeat` for the room size. */
export function paintFloor(texture: CanvasTexture, zone: ZoneId, style: ZoneStyle): void {
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.globalAlpha = 1;
  PAINTERS[zone](ctx, canvas.width, style, seeded(SEEDS[zone]));
  texture.needsUpdate = true;
}

export function createFloorTexture(zone: ZoneId, style: ZoneStyle, widthM: number, depthM: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = PX * TILE_M;
  canvas.height = PX * TILE_M;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(widthM / TILE_M, depthM / TILE_M);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  paintFloor(texture, zone, style);
  return texture;
}
