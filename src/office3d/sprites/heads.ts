import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import {
  type FacingName,
  type Figure,
  HEAD_ATLAS_SIZE,
  HEAD_CELL_CENTER,
  HEAD_CELL_H,
  HEAD_CELL_W,
  HEAD_SIZE,
  PX,
} from './sprite.types';

/** Plain heads for bots without an avatar: short hair for the male figure, long hair for the female one. */

const OUTLINE = '#3d4350';
const SKIN = '#f4dfcb';
const SKIN_SHADE = '#e3bfa4';
const SKIN_LIGHT = '#fdf1e5';
const HAIR = '#5a4636';
const HAIR_LIGHT = '#806751';
const HAIR_DEEP = '#43342a';
const EYE = '#2b2b2b';
const BLUSH = 'rgba(232,130,120,0.38)';

type Ctx = CanvasRenderingContext2D;

const RADIUS = HEAD_SIZE / 2 - 0.8;
const CX = HEAD_CELL_CENTER.x;
const CY = HEAD_CELL_CENTER.y;

function circle(ctx: Ctx, radius = RADIUS): void {
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rotation = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function outline(ctx: Ctx, width = 1.2): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function skinFace(ctx: Ctx): void {
  circle(ctx);
  const gradient = ctx.createRadialGradient(CX - 3, CY - 3.4, 1, CX, CY, RADIUS + 1);
  gradient.addColorStop(0, SKIN_LIGHT);
  gradient.addColorStop(0.55, SKIN);
  gradient.addColorStop(1, SKIN_SHADE);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function faceDetails(ctx: Ctx, eyeY: number): void {
  for (const side of [-1, 1]) {
    const x = CX + side * 3.2;
    ellipse(ctx, x, eyeY, 1.05, 1.55, EYE);
    ellipse(ctx, x - 0.35, eyeY - 0.55, 0.38, 0.38, '#ffffff');
    ellipse(ctx, CX + side * 5.6, eyeY + 2, 1.5, 0.95, BLUSH);
    ctx.beginPath();
    ctx.moveTo(x - 1.3, eyeY - 2.7);
    ctx.quadraticCurveTo(x, eyeY - 3.4 + (side < 0 ? 0 : 0.2), x + 1.3, eyeY - 2.6);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = HAIR_DEEP;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(CX - 1.5, eyeY + 3.5);
  ctx.quadraticCurveTo(CX, eyeY + 4.6, CX + 1.5, eyeY + 3.5);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = '#a5645a';
  ctx.stroke();
}

function maleFront(ctx: Ctx): void {
  for (const side of [-1, 1]) {
    ellipse(ctx, CX + side * (RADIUS - 0.1), CY + 1, 1.5, 2, SKIN_SHADE);
    ctx.beginPath();
    ctx.ellipse(CX + side * (RADIUS - 0.1), CY + 1, 1.5, 2, 0, 0, Math.PI * 2);
    outline(ctx, 0.7);
  }
  skinFace(ctx);
  faceDetails(ctx, CY + 1.2);
  ctx.save();
  circle(ctx);
  ctx.clip();
  // Short hair with a side-swept fringe.
  ctx.beginPath();
  ctx.moveTo(CX - RADIUS - 1, CY - 0.5);
  ctx.lineTo(CX - RADIUS - 1, CY - RADIUS - 2);
  ctx.lineTo(CX + RADIUS + 1, CY - RADIUS - 2);
  ctx.lineTo(CX + RADIUS + 1, CY - 0.5);
  ctx.quadraticCurveTo(CX + 7, CY - 2.6, CX + 4.6, CY - 4.4);
  ctx.quadraticCurveTo(CX + 2, CY - 2.2, CX - 1, CY - 4.6);
  ctx.quadraticCurveTo(CX - 3.4, CY - 2.8, CX - 6.4, CY - 4);
  ctx.quadraticCurveTo(CX - 8.4, CY - 3, CX - RADIUS - 1, CY - 0.5);
  ctx.closePath();
  ctx.fillStyle = HAIR;
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = HAIR_DEEP;
  ctx.stroke();
  ellipse(ctx, CX - 3, CY - 7.2, 3.6, 1.1, HAIR_LIGHT, -0.25);
  ctx.restore();
  circle(ctx);
  outline(ctx);
}

function maleBack(ctx: Ctx): void {
  for (const side of [-1, 1]) {
    ellipse(ctx, CX + side * (RADIUS - 0.1), CY + 1, 1.5, 2, SKIN_SHADE);
    ctx.beginPath();
    ctx.ellipse(CX + side * (RADIUS - 0.1), CY + 1, 1.5, 2, 0, 0, Math.PI * 2);
    outline(ctx, 0.7);
  }
  circle(ctx);
  ctx.fillStyle = HAIR;
  ctx.fill();
  ctx.save();
  circle(ctx);
  ctx.clip();
  // Nape of the neck below the hairline.
  ctx.beginPath();
  ctx.moveTo(CX - 6, CY + RADIUS);
  ctx.quadraticCurveTo(CX - 4, CY + 4.2, CX, CY + 5.2);
  ctx.quadraticCurveTo(CX + 4, CY + 4.2, CX + 6, CY + RADIUS);
  ctx.closePath();
  ctx.fillStyle = SKIN_SHADE;
  ctx.fill();
  ellipse(ctx, CX - 3, CY - 4.6, 4, 1.2, HAIR_LIGHT, -0.3);
  ctx.beginPath();
  ctx.moveTo(CX + 1, CY - 8);
  ctx.quadraticCurveTo(CX + 4, CY - 4, CX + 2.4, CY + 1);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = HAIR_DEEP;
  ctx.stroke();
  ctx.restore();
  circle(ctx);
  outline(ctx);
}

function femaleFront(ctx: Ctx): void {
  for (const side of [-1, 1]) {
    roundedRect(ctx, side < 0 ? CX - 10 : CX + 5.6, CY - 4, 4.4, 14.5, 2.2);
    ctx.fillStyle = HAIR;
    ctx.fill();
    outline(ctx);
    ctx.beginPath();
    ctx.moveTo(CX + side * 7.8, CY - 1);
    ctx.lineTo(CX + side * 7.6, CY + 8.4);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = HAIR_LIGHT;
    ctx.stroke();
  }
  skinFace(ctx);
  faceDetails(ctx, CY + 1.9);
  ctx.save();
  circle(ctx);
  ctx.clip();
  // Fringe sweeping across the forehead.
  ctx.beginPath();
  ctx.moveTo(CX - RADIUS - 1, CY + 1);
  ctx.lineTo(CX - RADIUS - 1, CY - RADIUS - 2);
  ctx.lineTo(CX + RADIUS + 1, CY - RADIUS - 2);
  ctx.lineTo(CX + RADIUS + 1, CY + 1);
  ctx.quadraticCurveTo(CX + 6.6, CY - 2.4, CX + 2.2, CY - 3.6);
  ctx.quadraticCurveTo(CX - 1.6, CY - 2.2, CX - 4.6, CY - 3);
  ctx.quadraticCurveTo(CX - 7.6, CY - 1.4, CX - RADIUS - 1, CY + 1);
  ctx.closePath();
  ctx.fillStyle = HAIR;
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = HAIR_DEEP;
  ctx.stroke();
  ellipse(ctx, CX + 2, CY - 7, 4.2, 1.1, HAIR_LIGHT, 0.2);
  ctx.restore();
  circle(ctx);
  outline(ctx);
}

function femaleBack(ctx: Ctx): void {
  roundedRect(ctx, CX - 9.6, CY - 4, 19.2, 16.5, 6);
  ctx.fillStyle = HAIR;
  ctx.fill();
  outline(ctx);
  circle(ctx);
  ctx.fillStyle = HAIR;
  ctx.fill();
  ctx.save();
  circle(ctx);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(CX - 2, CY - 9);
  ctx.quadraticCurveTo(CX + 4, CY - 4, CX + 1, CY + 4);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = HAIR_LIGHT;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(CX - 6, CY + 6);
  ctx.quadraticCurveTo(CX, CY + 9, CX + 6, CY + 6);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = HAIR_DEEP;
  ctx.stroke();
  circle(ctx);
  outline(ctx);
}

const CELLS: readonly { figure: Figure; facing: FacingName; col: number; row: number; draw: (ctx: Ctx) => void }[] = [
  { figure: 'male', facing: 'front', col: 0, row: 0, draw: maleFront },
  { figure: 'male', facing: 'back', col: 1, row: 0, draw: maleBack },
  { figure: 'female', facing: 'front', col: 0, row: 1, draw: femaleFront },
  { figure: 'female', facing: 'back', col: 1, row: 1, draw: femaleBack },
];

export interface HeadCell {
  /** Lower-left u, v and extent of the cell in the head atlas. */
  readonly u: number;
  readonly v: number;
  readonly du: number;
  readonly dv: number;
}

const HEAD_CELLS: readonly HeadCell[] = CELLS.map((cell) => {
  const du = (HEAD_CELL_W * PX) / HEAD_ATLAS_SIZE;
  const dv = (HEAD_CELL_H * PX) / HEAD_ATLAS_SIZE;
  return { u: cell.col * du, v: 1 - (cell.row + 1) * dv, du, dv };
});

export function headCell(figure: Figure, facing: FacingName): HeadCell {
  const index = CELLS.findIndex((cell) => cell.figure === figure && cell.facing === facing);
  return HEAD_CELLS[index] ?? { u: 0, v: 0, du: 1, dv: 1 };
}

export function paintHeads(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = HEAD_ATLAS_SIZE;
  canvas.height = HEAD_ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const cell of CELLS) {
    ctx.save();
    ctx.translate(cell.col * HEAD_CELL_W * PX, cell.row * HEAD_CELL_H * PX);
    ctx.beginPath();
    ctx.rect(0, 0, HEAD_CELL_W * PX, HEAD_CELL_H * PX);
    ctx.clip();
    ctx.scale(PX, PX);
    cell.draw(ctx);
    ctx.restore();
  }
  return canvas;
}

export function headAtlasTexture(): CanvasTexture {
  const texture = new CanvasTexture(paintHeads());
  texture.colorSpace = SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
