import { CX, type FrameSpec, type Limb, type Pt, STAND_HIP_Y, frameTable } from './poses';
import { ATLAS_W, CELL_H, CELL_W, type FacingName, PX, type PoseSet, type SheetKind, atlasHeight } from './sprite.types';

/**
 * Procedural painters for the chibi figure at 2x detail: every frame is drawn in figure units
 * (32 x 48) and baked at PX pixels per unit. Tinted layers (shirt, dress, accent) are painted in
 * neutral greys so the shader can multiply the bot colour onto them; legs and hands keep their own colours.
 */

type Ctx = CanvasRenderingContext2D;

const OUTLINE = '#3d4350';
const SKIN = '#f4dfcb';
const SKIN_SHADE = '#dfb99c';
const SKIN_LIGHT = '#fcefe2';
const TROUSER = '#56607a';
const TROUSER_SHADE = '#434b63';
const TROUSER_LIGHT = '#707c9c';
const SHOE = '#2c303a';
const SHOE_LIGHT = '#505766';
const SOLE = '#ddd6c8';

const SHIRT = '#eeeeee';
const SHIRT_LIGHT = '#fbfbfb';
const SHIRT_SHADE = '#cdcdcd';
const SHIRT_DEEP = '#b4b4b4';
const SLEEVE = '#e4e4e4';
const DRESS = '#bcbcbc';
const DRESS_SHADE = '#9a9a9a';
const DRESS_DEEP = '#858585';
const DRESS_LIGHT = '#ffffff';
const ACCENT = '#ffffff';
const ACCENT_SHADE = '#cfcfcf';

function pt(x: number, y: number): Pt {
  return { x, y };
}

function strokeLimb(ctx: Ctx, limb: Limb, width: number, color: string): void {
  const first = limb[0];
  if (first === undefined) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const p of limb.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function limbWithOutline(ctx: Ctx, limb: Limb, width: number, fill: string, edge = 1): void {
  strokeLimb(ctx, limb, width + edge * 2, OUTLINE);
  strokeLimb(ctx, limb, width, fill);
}

/** The limb shifted sideways by `distance`, positive toward the lit (upper-left) side. */
function offsetLimb(limb: Limb, distance: number): Limb {
  return limb.map((p, i) => {
    const a = limb[Math.max(0, i - 1)] ?? p;
    const b = limb[Math.min(limb.length - 1, i + 1)] ?? p;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / length;
    let ny = (b.x - a.x) / length;
    if (nx + ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    return pt(p.x + nx * distance, p.y + ny * distance);
  });
}

function disc(ctx: Ctx, p: Pt, rx: number, ry: number, fill: string, edge = 0.9): void {
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge > 0) {
    ctx.lineWidth = edge;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
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

function tip(limb: Limb): Pt {
  return limb[limb.length - 1] ?? pt(CX, 0);
}

function drawShoe(ctx: Ctx, leg: Limb, spec: FrameSpec): void {
  const end = tip(leg);
  const x = end.x + (spec.footDx ?? (end.x < CX ? -0.2 : 0.2));
  const y = end.y + 0.6;
  disc(ctx, pt(x, y + 0.75), 3.6, 2.0, SOLE, 0.9);
  disc(ctx, pt(x, y), 3.6, 2.15, SHOE, 0.9);
  disc(ctx, pt(x - 0.9, y - 0.7), 1.5, 0.55, SHOE_LIGHT, 0);
}

function drawLegs(ctx: Ctx, spec: FrameSpec): void {
  for (const leg of spec.legs) {
    limbWithOutline(ctx, leg, 4.6, TROUSER);
    strokeLimb(ctx, offsetLimb(leg, -1.35), 1.2, TROUSER_SHADE);
    strokeLimb(ctx, offsetLimb(leg, 1.25), 1.0, TROUSER_LIGHT);
    // Cuff near the ankle.
    const end = tip(leg);
    const before = leg[leg.length - 2] ?? end;
    const cuff = pt(end.x + (before.x - end.x) * 0.16, end.y + (before.y - end.y) * 0.16);
    strokeLimb(ctx, [cuff, end], 4.7, TROUSER_SHADE);
    if (spec.shoes) drawShoe(ctx, leg, spec);
  }
}

function drawBareLegs(ctx: Ctx, spec: FrameSpec): void {
  for (const leg of spec.legs) {
    limbWithOutline(ctx, leg, 3.7, SKIN);
    strokeLimb(ctx, offsetLimb(leg, -1.1), 0.9, SKIN_SHADE);
    strokeLimb(ctx, offsetLimb(leg, 1.0), 0.8, SKIN_LIGHT);
    // Ankle sock.
    const end = tip(leg);
    const before = leg[leg.length - 2] ?? end;
    const sock = pt(end.x + (before.x - end.x) * 0.1, end.y + (before.y - end.y) * 0.1);
    strokeLimb(ctx, [sock, end], 3.9, '#f6f2ea');
    if (spec.shoes) drawShoe(ctx, leg, spec);
  }
}

function drawHand(ctx: Ctx, p: Pt): void {
  disc(ctx, p, 2.3, 2.2, SKIN, 1);
  disc(ctx, pt(p.x - 0.6, p.y - 0.7), 1.2, 0.8, SKIN_LIGHT, 0);
  // Thumb and a finger line keep the hand from reading as a plain ball.
  disc(ctx, pt(p.x + (p.x < CX ? 1.9 : -1.9), p.y - 0.5), 0.8, 1.1, SKIN, 0.6);
  ctx.beginPath();
  ctx.moveTo(p.x - 0.7, p.y + 0.9);
  ctx.lineTo(p.x + 0.7, p.y + 1.9);
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = SKIN_SHADE;
  ctx.stroke();
}

function drawEnvelope(ctx: Ctx, x: number, y: number, w: number, h: number, tilt: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  roundedRect(ctx, -w / 2, -h / 2, w, h, 0.9);
  ctx.fillStyle = '#f6efdc';
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 0.4, -h / 2 + 0.5);
  ctx.lineTo(0, 0.6);
  ctx.lineTo(w / 2 - 0.4, -h / 2 + 0.5);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = '#b9a67a';
  ctx.stroke();
  roundedRect(ctx, w / 2 - 3, h / 2 - 2.5, 2, 1.6, 0.3);
  ctx.fillStyle = '#d9654f';
  ctx.fill();
  ctx.restore();
}

function line(ctx: Ctx, a: Pt, b: Pt, width: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

const STEEL = '#c9ced6';
const WOOD = '#c9a26b';
const WOOD_DARK = '#8d6240';

function drawFork(ctx: Ctx, hand: Pt, angle: number, food: boolean): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const neck = pt(hand.x + dx * 4.2, hand.y + dy * 4.2);
  line(ctx, pt(hand.x - dx * 1.2, hand.y - dy * 1.2), neck, 1.9, OUTLINE);
  line(ctx, pt(hand.x - dx * 1.2, hand.y - dy * 1.2), neck, 1, STEEL);
  for (const k of [-0.9, 0, 0.9]) {
    const base = pt(neck.x - dy * k, neck.y + dx * k);
    const end = pt(base.x + dx * 2.2, base.y + dy * 2.2);
    line(ctx, base, end, 1.2, OUTLINE);
    line(ctx, base, end, 0.5, STEEL);
  }
  if (food) disc(ctx, pt(neck.x + dx * 2, neck.y + dy * 2), 1.4, 1.1, '#e0705a', 0.6);
}

function drawCue(ctx: Ctx, from: Pt, to: Pt): void {
  line(ctx, from, to, 2.3, OUTLINE);
  line(ctx, from, to, 1.3, WOOD);
  line(ctx, from, pt(from.x + (to.x - from.x) * 0.22, from.y + (to.y - from.y) * 0.22), 1.5, WOOD_DARK);
  disc(ctx, to, 0.9, 0.9, '#5aa6c8', 0.5);
}

function drawGrips(ctx: Ctx, spec: FrameSpec, phase: number): void {
  spec.arms.forEach((arm, side) => {
    const hand = tip(arm);
    const outward = side === 0 ? -1 : 1;
    line(ctx, pt(hand.x + outward * 1, hand.y), pt(hand.x + outward * 8.4, hand.y), 1.5, OUTLINE);
    line(ctx, pt(hand.x + outward * 1, hand.y), pt(hand.x + outward * 8.4, hand.y), 0.8, STEEL);
    roundedRect(ctx, hand.x - 3.2, hand.y - 1.5, 6.4, 3, 1.2);
    ctx.fillStyle = '#2f3440';
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Ridges roll around the grip as the wrist twists.
    ctx.fillStyle = '#6b7488';
    for (let k = 0; k < 3; k += 1) ctx.fillRect(hand.x - 2.6 + ((k * 1.8 + phase * 0.9 + side) % 5.2), hand.y - 1.1, 0.6, 2.2);
    roundedRect(ctx, hand.x + outward * 3.2 - 0.8, hand.y - 1.6, 1.6, 3.2, 0.6);
    ctx.fillStyle = '#d9654f';
    ctx.fill();
  });
}

function drawPad(ctx: Ctx, spec: FrameSpec, phase: number): void {
  const left = tip(spec.arms[0]);
  const right = tip(spec.arms[1]);
  const cx = (left.x + right.x) / 2;
  const cy = (left.y + right.y) / 2 + 1.6;
  roundedRect(ctx, cx - 7.2, cy - 2.6, 14.4, 5.2, 2.4);
  ctx.fillStyle = '#394050';
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  disc(ctx, pt(cx - 5.2, cy + 0.2), 2.2, 2, '#4d5668', 0.4);
  disc(ctx, pt(cx + 5.2, cy + 0.2), 2.2, 2, '#4d5668', 0.4);
  const lit = phase % 4;
  ['#e0705a', '#e3b34f', '#6fa57a', '#4f9aa6'].forEach((color, i) => {
    const bx = cx + 5.2 + (i % 2 === 0 ? -1 : 1) * 0.9;
    const by = cy + 0.2 + (i < 2 ? -0.9 : 0.9);
    disc(ctx, pt(bx, by), 0.55, 0.55, i === lit ? '#ffffff' : color, 0);
  });
}

function drawProp(ctx: Ctx, spec: FrameSpec): void {
  const prop = spec.prop;
  if (prop === undefined) return;
  if (prop.kind === 'fork') drawFork(ctx, tip(spec.arms[1]), prop.angle, prop.food);
  else if (prop.kind === 'cue') drawCue(ctx, prop.from, prop.to);
  else if (prop.kind === 'grips') drawGrips(ctx, spec, prop.phase);
  else drawPad(ctx, spec, prop.phase);
}

function drawHands(ctx: Ctx, spec: FrameSpec): void {
  drawProp(ctx, spec);
  if (spec.carry === 'chest') drawEnvelope(ctx, CX, spec.torsoTop + 11.6, 10, 7, 0);
  if (spec.carry === 'side') drawEnvelope(ctx, CX + 10.4, spec.torsoTop + 12.4, 8.4, 6, -0.14);
  for (const arm of spec.arms) drawHand(ctx, tip(arm));
}

function torsoPath(ctx: Ctx, spec: FrameSpec, width: number): void {
  roundedRect(ctx, CX - width / 2, spec.torsoTop, width, spec.torsoBottom - spec.torsoTop, 5);
}

function sleeve(ctx: Ctx, arm: Limb, fill: string, shade: string): void {
  limbWithOutline(ctx, arm, 3.9, fill, 0.9);
  strokeLimb(ctx, offsetLimb(arm, -1.1), 0.9, shade);
}

function drawShirt(ctx: Ctx, spec: FrameSpec, facing: FacingName): void {
  const width = 14.4;
  const height = spec.torsoBottom - spec.torsoTop;
  torsoPath(ctx, spec, width);
  ctx.fillStyle = SHIRT;
  ctx.fill();
  ctx.save();
  torsoPath(ctx, spec, width);
  ctx.clip();
  const shade = ctx.createLinearGradient(CX - 1, 0, CX + 7.2, 0);
  shade.addColorStop(0, 'rgba(180,180,180,0)');
  shade.addColorStop(1, SHIRT_SHADE);
  ctx.fillStyle = shade;
  ctx.fillRect(CX - 1, spec.torsoTop, 9, height);
  ctx.fillStyle = SHIRT_LIGHT;
  ctx.fillRect(CX - width / 2, spec.torsoTop, 2.4, height);
  ctx.fillStyle = SHIRT_SHADE;
  ctx.fillRect(CX - width / 2, spec.torsoBottom - 2.8, width, 2.8);
  // Soft folds across the belly and a pinch under the arm.
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = SHIRT_DEEP;
  for (const [x0, y0, x1, y1] of [
    [CX - 4.4, spec.torsoBottom - 6.6, CX - 1.4, spec.torsoBottom - 3.4],
    [CX + 2.6, spec.torsoBottom - 7.6, CX + 5.2, spec.torsoBottom - 3.2],
    [CX + 4.6, spec.torsoTop + 5, CX + 5.8, spec.torsoTop + 9],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + 0.8, (y0 + y1) / 2 - 0.4, x1, y1);
    ctx.stroke();
  }
  ctx.restore();
  torsoPath(ctx, spec, width);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  const top = spec.torsoTop;
  if (facing === 'front') {
    // Collar flaps, placket and buttons.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(CX + side * 4.2, top - 0.1);
      ctx.lineTo(CX + side * 0.2, top + 4.2);
      ctx.lineTo(CX + side * 0.4, top + 0.2);
      ctx.closePath();
      ctx.fillStyle = SHIRT_LIGHT;
      ctx.fill();
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = SHIRT_DEEP;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(CX, top + 4.2);
    ctx.lineTo(CX, spec.torsoBottom - 0.6);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = SHIRT_DEEP;
    ctx.stroke();
    for (const by of [top + 7, top + 10.4]) disc(ctx, pt(CX + 0.9, by), 0.45, 0.45, SHIRT_DEEP, 0);
  } else {
    ctx.beginPath();
    ctx.moveTo(CX - 4.6, top + 0.5);
    ctx.quadraticCurveTo(CX, top + 3.4, CX + 4.6, top + 0.5);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = SHIRT_DEEP;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX, top + 2.6);
    ctx.lineTo(CX, spec.torsoBottom - 1);
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  for (const arm of spec.arms) {
    sleeve(ctx, arm, SLEEVE, SHIRT_DEEP);
    const end = tip(arm);
    const before = arm[arm.length - 2] ?? end;
    strokeLimb(ctx, [pt(end.x + (before.x - end.x) * 0.2, end.y + (before.y - end.y) * 0.2), end], 3.9, SHIRT_SHADE);
  }
}

interface DressShape {
  readonly waist: number;
  trace(ctx: Ctx): void;
  trim(ctx: Ctx): void;
}

function dressShape(spec: FrameSpec): DressShape {
  const waist = spec.torsoBottom - 3.4;
  const hip = spec.legs[0][0]?.y ?? STAND_HIP_Y;
  if (spec.seated === true) {
    const hem = hip + 4.6;
    return {
      waist,
      trace(ctx) {
        ctx.beginPath();
        ctx.moveTo(CX - 8, waist - 1);
        ctx.lineTo(CX + 8, waist - 1.6);
        ctx.lineTo(CX + 13, hip - 2.6);
        ctx.lineTo(CX + 14.8, hip + 3.8);
        ctx.quadraticCurveTo(CX + 3, hem + 2.6, CX - 9.4, hem);
        ctx.closePath();
      },
      trim(ctx) {
        ctx.beginPath();
        ctx.moveTo(CX + 14, hip + 2.2);
        ctx.quadraticCurveTo(CX + 3, hem + 0.9, CX - 8.6, hem - 1.2);
      },
    };
  }
  const sway = spec.hemSway ?? 0;
  const hem = hip + 6.3;
  const half = 10.8 + Math.abs(sway) * 0.4;
  return {
    waist,
    trace(ctx) {
      ctx.beginPath();
      ctx.moveTo(CX - 6, waist);
      ctx.lineTo(CX + 6, waist);
      ctx.lineTo(CX + half + sway, hem);
      ctx.quadraticCurveTo(CX + sway, hem + 2.6, CX - half + sway, hem);
      ctx.closePath();
    },
    trim(ctx) {
      ctx.beginPath();
      ctx.moveTo(CX + half - 0.9 + sway, hem - 1.3);
      ctx.quadraticCurveTo(CX + sway, hem + 1.2, CX - half + 0.9 + sway, hem - 1.3);
    },
  };
}

/** Light motif on the garment; stays a lighter shade of whatever colour tints the sheet. */
function paintPattern(ctx: Ctx, variant: number, top: number, bottom: number, apexY: number): void {
  ctx.fillStyle = DRESS_LIGHT;
  ctx.strokeStyle = DRESS_LIGHT;
  if (variant === 1) {
    // Stripes fanning out from above the neckline, so they follow the flare of the skirt.
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'butt';
    for (let k = -9; k <= 9; k += 1) {
      const angle = k * 0.1;
      ctx.beginPath();
      ctx.moveTo(CX, apexY);
      ctx.lineTo(CX + Math.sin(angle) * 60, apexY + Math.cos(angle) * 60);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    return;
  }
  let row = 0;
  const stepY = variant === 0 ? 4.8 : 6.4;
  const stepX = variant === 0 ? 6.2 : 8.2;
  for (let y = top + 1; y < bottom; y += stepY) {
    for (let x = CX - 17 + (row % 2) * (stepX / 2); x < CX + 19; x += stepX) {
      if (variant === 0) {
        ctx.beginPath();
        ctx.arc(x, y, 1.75, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (const [dx, dy] of [[-1.8, 0], [1.8, 0], [0, -1.8], [0, 1.8]] as const) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 1.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = DRESS_DEEP;
      ctx.beginPath();
      ctx.arc(x, y, 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = DRESS_LIGHT;
    }
    row += 1;
  }
}

function paintGarment(ctx: Ctx, trace: () => void, variant: number, spec: FrameSpec, shadeFrom: number): void {
  trace();
  ctx.fillStyle = DRESS;
  ctx.fill();
  ctx.save();
  ctx.clip();
  paintPattern(ctx, variant, spec.torsoTop, 48, spec.torsoTop - 6);
  const shade = ctx.createLinearGradient(shadeFrom - 3, 0, shadeFrom + 7, 0);
  shade.addColorStop(0, 'rgba(120,120,120,0)');
  shade.addColorStop(1, 'rgba(120,120,120,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(shadeFrom - 3, spec.torsoTop, 20, 30);
  ctx.restore();
  trace();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function drawDress(ctx: Ctx, spec: FrameSpec, variant: number): void {
  const shape = dressShape(spec);
  paintGarment(ctx, () => shape.trace(ctx), variant, spec, CX + 3.4);
  // Soft fold lines running down the skirt from the waist.
  ctx.save();
  shape.trace(ctx);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = DRESS_SHADE;
  for (const dx of spec.seated === true ? [3, 8, 12] : [-5, -1.5, 3, 6.5]) {
    ctx.beginPath();
    ctx.moveTo(CX + dx * 0.45, shape.waist + 1);
    ctx.lineTo(CX + dx * 1.15 + (spec.hemSway ?? 0), 48);
    ctx.stroke();
  }
  ctx.restore();
  paintGarment(
    ctx,
    () => roundedRect(ctx, CX - 7.2, spec.torsoTop, 14.4, shape.waist - spec.torsoTop + 1, 5),
    variant,
    spec,
    CX + 2.4,
  );
  for (const arm of spec.arms) {
    sleeve(ctx, arm, DRESS, DRESS_DEEP);
    // Pattern on the sleeve cap only; the rest stays plain so the arm reads clearly.
    const root = arm[0];
    if (root !== undefined) {
      ctx.fillStyle = DRESS_LIGHT;
      ctx.beginPath();
      ctx.arc(root.x + (root.x < CX ? -0.4 : 0.4), root.y + 1.6, 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawAccent(ctx: Ctx, spec: FrameSpec, facing: FacingName): void {
  const shape = dressShape(spec);
  ctx.lineCap = 'round';
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.7;
  shape.trim(ctx);
  ctx.stroke();
  ctx.setLineDash([0.1, 2.3]);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = ACCENT_SHADE;
  shape.trim(ctx);
  ctx.stroke();
  ctx.setLineDash([]);
  // Sash.
  roundedRect(ctx, CX - 7.4, shape.waist - 1.7, 14.8, 3.6, 1.4);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Knot with two short tails.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX + side * 0.8, shape.waist + 1);
    ctx.lineTo(CX + side * 3.2, shape.waist + 5);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
  }
  roundedRect(ctx, CX - 1.7, shape.waist - 1.7, 3.4, 3.6, 1);
  ctx.fillStyle = ACCENT_SHADE;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Round collar.
  ctx.beginPath();
  if (facing === 'front') {
    ctx.moveTo(CX - 5.2, spec.torsoTop + 0.2);
    ctx.quadraticCurveTo(CX, spec.torsoTop + 5.4, CX + 5.2, spec.torsoTop + 0.2);
    ctx.quadraticCurveTo(CX, spec.torsoTop + 2.2, CX - 5.2, spec.torsoTop + 0.2);
  } else {
    ctx.moveTo(CX - 5.2, spec.torsoTop + 0.4);
    ctx.quadraticCurveTo(CX, spec.torsoTop + 3.6, CX + 5.2, spec.torsoTop + 0.4);
    ctx.quadraticCurveTo(CX, spec.torsoTop + 1.6, CX - 5.2, spec.torsoTop + 0.4);
  }
  ctx.closePath();
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Cuffs.
  for (const arm of spec.arms) {
    const end = tip(arm);
    const before = arm[arm.length - 2] ?? end;
    strokeLimb(ctx, [pt(end.x + (before.x - end.x) * 0.22, end.y + (before.y - end.y) * 0.22), end], 4.3, OUTLINE);
    strokeLimb(ctx, [pt(end.x + (before.x - end.x) * 0.2, end.y + (before.y - end.y) * 0.2), end], 3.5, ACCENT);
  }
}

type LayerDrawer = (ctx: Ctx, spec: FrameSpec, facing: FacingName) => void;

const DRAWERS: Readonly<Record<SheetKind, LayerDrawer>> = {
  'legs-male': (ctx, spec) => drawLegs(ctx, spec),
  'legs-bare': (ctx, spec) => drawBareLegs(ctx, spec),
  hands: (ctx, spec) => drawHands(ctx, spec),
  'upper-male': drawShirt,
  'dress-0': (ctx, spec) => drawDress(ctx, spec, 0),
  'dress-1': (ctx, spec) => drawDress(ctx, spec, 1),
  'dress-2': (ctx, spec) => drawDress(ctx, spec, 2),
  accent: drawAccent,
};

/** Sheets that keep their own colours; every other sheet is a grey tinted in the shader. */
export function isColouredSheet(kind: SheetKind): boolean {
  return kind === 'legs-male' || kind === 'legs-bare' || kind === 'hands';
}

/** Paints one full atlas sheet (all poses of the set, both facings) onto a fresh atlas-sized canvas. */
export function paintSheet(kind: SheetKind, set: PoseSet = 'base'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = atlasHeight(set);
  const ctx = canvas.getContext('2d', { willReadFrequently: !isColouredSheet(kind) });
  if (ctx === null) return canvas;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const draw = DRAWERS[kind];
  for (const entry of frameTable(set)) {
    ctx.save();
    ctx.translate(entry.col * CELL_W, entry.row * CELL_H);
    ctx.beginPath();
    ctx.rect(0, 0, CELL_W, CELL_H);
    ctx.clip();
    ctx.scale(PX, PX);
    ctx.translate(entry.spec.bodyDx ?? 0, 0);
    draw(ctx, entry.spec, entry.facing);
    ctx.restore();
  }
  return canvas;
}
