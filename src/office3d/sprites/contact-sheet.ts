import { paintHeads } from './heads';
import { paintSheet } from './paint';
import { dressColors } from './dress-colors';
import { FRAME_COUNT, FRAME_W, FRAME_H, HEAD_CELL_CENTER, HEAD_CELL_H, HEAD_CELL_W, HEAD_CENTER_Y, PX, CELL_H, CELL_W, type PoseName, type PoseSet, SET_POSES, type SheetKind } from './sprite.types';
import { frameTable } from './poses';

/** Dev-only page (`?sheet=light|dark`, plus `&set=activity` for the eat, play and lounge poses): every pose and facing of both figures, composited on the CPU. */

const SCALE = new URLSearchParams(window.location.search).has('zoom') ? 1 : 0.5;
const SAMPLE_BOT = 0x4f8fe0;

function tintedCell(source: HTMLCanvasElement, sx: number, sy: number, color: number): HTMLCanvasElement {
  const cell = document.createElement('canvas');
  cell.width = CELL_W;
  cell.height = CELL_H;
  const ctx = cell.getContext('2d');
  if (ctx === null) return cell;
  ctx.drawImage(source, sx, sy, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, CELL_W, CELL_H);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(source, sx, sy, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
  return cell;
}

interface FigureSheets {
  readonly legs: HTMLCanvasElement;
  readonly upper: HTMLCanvasElement;
  readonly accent: HTMLCanvasElement | null;
  readonly hands: HTMLCanvasElement;
  readonly female: boolean;
  readonly tint: number;
  readonly accentTint: number;
}

function columnsPerFacing(set: PoseSet): number {
  return Math.max(...SET_POSES[set].map((pose) => FRAME_COUNT[pose]));
}

function figureSheets(set: PoseSet, legs: SheetKind, upper: SheetKind, hands: HTMLCanvasElement, accent: HTMLCanvasElement | null): FigureSheets {
  const colors = dressColors(SAMPLE_BOT, 1);
  const female = accent !== null;
  return {
    legs: paintSheet(legs, set),
    upper: paintSheet(upper, set),
    accent,
    hands,
    female,
    tint: female ? colors.dress : SAMPLE_BOT,
    accentTint: colors.accent,
  };
}

function drawFigureBlock(ctx: CanvasRenderingContext2D, set: PoseSet, sheets: FigureSheets, heads: HTMLCanvasElement, ox: number, oy: number): void {
  const perFacing = columnsPerFacing(set);
  const cw = FRAME_W * PX * SCALE;
  const ch = FRAME_H * PX * SCALE;
  SET_POSES[set].forEach((pose, poseRow) => {
    for (const entry of frameTable(set)) {
      if (entry.pose !== pose) continue;
      const facingOffset = entry.facing === 'back' ? perFacing : 0;
      const dx = ox + (facingOffset + entry.index) * cw;
      const dy = oy + poseRow * ch;
      const sx = entry.col * CELL_W;
      const sy = entry.row * CELL_H;
      const stack = document.createElement('canvas');
      stack.width = CELL_W;
      stack.height = CELL_H;
      const sctx = stack.getContext('2d');
      if (sctx === null) continue;
      sctx.drawImage(sheets.legs, sx, sy, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
      sctx.drawImage(tintedCell(sheets.upper, sx, sy, sheets.tint), 0, 0);
      if (sheets.accent !== null) sctx.drawImage(tintedCell(sheets.accent, sx, sy, sheets.accentTint), 0, 0);
      sctx.drawImage(sheets.hands, sx, sy, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
      const headCol = entry.facing === 'back' ? 1 : 0;
      const headRow = sheets.female ? 1 : 0;
      const hx = (FRAME_W / 2 + entry.headDx - HEAD_CELL_CENTER.x) * PX;
      const hy = (HEAD_CENTER_Y + entry.headDy - HEAD_CELL_CENTER.y) * PX;
      sctx.drawImage(heads, headCol * HEAD_CELL_W * PX, headRow * HEAD_CELL_H * PX, HEAD_CELL_W * PX, HEAD_CELL_H * PX, hx, hy, HEAD_CELL_W * PX, HEAD_CELL_H * PX);
      ctx.drawImage(stack, dx, dy, cw, ch);
    }
  });
}

export function mountContactSheet(container: HTMLElement, mode: string): () => void {
  const dark = mode === 'dark';
  const set: PoseSet = new URLSearchParams(window.location.search).get('set') === 'activity' ? 'activity' : 'base';
  const poses: readonly PoseName[] = SET_POSES[set];
  const heads = paintHeads();
  const hands = paintSheet('hands', set);
  const accent = paintSheet('accent', set);
  const figures: FigureSheets[] = [
    figureSheets(set, 'legs-male', 'upper-male', hands, null),
    figureSheets(set, 'legs-bare', 'dress-0', hands, accent),
    figureSheets(set, 'legs-bare', 'dress-1', hands, accent),
    figureSheets(set, 'legs-bare', 'dress-2', hands, accent),
  ];
  const blockW = columnsPerFacing(set) * 2 * FRAME_W * PX * SCALE;
  const blockH = poses.length * FRAME_H * PX * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = blockW * 2 + 12;
  canvas.height = blockH * 2 + 12;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = dark ? '#1b2250' : '#f6ead9';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    figures.forEach((sheets, index) => {
      drawFigureBlock(ctx, set, sheets, heads, (index % 2) * (blockW + 12), Math.floor(index / 2) * (blockH + 12));
    });
  }
  const frames = poses.map((pose) => `${pose} ${FRAME_COUNT[pose]}`).join(', ');
  canvas.setAttribute('aria-label', `Character frames: ${frames}`);
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  container.append(canvas);
  return () => canvas.remove();
}

