import { ATLAS_COLS, FACINGS, FRAME_COUNT, FRAME_W, type FacingName, type PoseName, type PoseSet, SET_POSES } from './sprite.types';

/**
 * Per-frame skeletons in figure units (a frame is 32 x 48). Carried over from the 2D scene's
 * humanoid frames; walk and carry gain a third more frames for a smoother stride.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Something held, drawn in the hands layer under the hands. Positions come from the arm tips. */
export type Prop =
  | { readonly kind: 'fork'; /** Direction the tines point, radians (0 = +x, pi/2 = down). */ readonly angle: number; readonly food: boolean }
  | { readonly kind: 'cue'; readonly from: Pt; readonly to: Pt }
  | { readonly kind: 'grips'; readonly phase: number }
  | { readonly kind: 'pad'; readonly phase: number };

/** A limb as a polyline from its root (hip or shoulder) to its tip (foot or hand). */
export type Limb = readonly Pt[];

export interface FrameSpec {
  readonly torsoTop: number;
  readonly torsoBottom: number;
  readonly legs: readonly [Limb, Limb];
  readonly arms: readonly [Limb, Limb];
  /** Feet visible (false for a seated figure seen from behind). */
  readonly shoes: boolean;
  /** Shoe offset toward the facing side; seated figures point their feet along the thighs. */
  readonly footDx?: number;
  /** Whole-figure shift inside the frame; the head follows through headDx. */
  readonly bodyDx?: number;
  readonly headDx: number;
  readonly headDy: number;
  /** Seated: thighs run sideways, which the dress drapes over. */
  readonly seated?: boolean;
  /** Sideways swing of the dress hem while walking. */
  readonly hemSway?: number;
  /** An envelope is held: at the chest from the front, out to the side from behind. */
  readonly carry?: 'chest' | 'side';
  readonly prop?: Prop;
}

export const CX = FRAME_W / 2;
const HIP_X = 3.3;
const SHOULDER_X = 7.4;
export const STAND_TORSO_TOP = 22.5;
export const STAND_TORSO_BOTTOM = 36;
export const STAND_HIP_Y = 33.5;
export const STAND_FOOT_Y = 44.4;
const SEAT_DROP = 4.5;
/** Seated figures shift left so the sideways thighs stay inside the frame. */
const SEAT_BODY_DX = -3;
const SEAT_HIP_Y = 37.8;
const SEAT_FOOT_Y = 44.4;
const SHOULDER_DROP = 3;

function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

function pt(x: number, y: number): Pt {
  return { x, y };
}

function standingLegs(footL: Pt, footR: Pt, hipY = STAND_HIP_Y): readonly [Limb, Limb] {
  return [
    [pt(CX - HIP_X, hipY), footL],
    [pt(CX + HIP_X, hipY), footR],
  ];
}

function plantedFeet(): readonly [Pt, Pt] {
  return [pt(CX - HIP_X - 0.6, STAND_FOOT_Y), pt(CX + HIP_X + 0.6, STAND_FOOT_Y)];
}

function shoulders(top: number): readonly [Pt, Pt] {
  const y = top + SHOULDER_DROP;
  return [pt(CX - SHOULDER_X, y), pt(CX + SHOULDER_X, y)];
}

function hanging(top: number, swayL = 0, swayR = 0, lowerL = 0, lowerR = 0): readonly [Limb, Limb] {
  const [sl, sr] = shoulders(top);
  return [
    [sl, pt(sl.x - 1.6 + swayL, top + 11.2 + lowerL)],
    [sr, pt(sr.x + 1.6 + swayR, top + 11.2 + lowerR)],
  ];
}

function standingFrame(top: number, arms: readonly [Limb, Limb], legs = standingLegs(...plantedFeet())): FrameSpec {
  return {
    torsoTop: top,
    torsoBottom: STAND_TORSO_BOTTOM,
    legs,
    arms,
    shoes: true,
    headDx: 0,
    headDy: top - STAND_TORSO_TOP,
  };
}

function idleFrame(index: number): FrameSpec {
  const top = STAND_TORSO_TOP + at([0, -0.5, -1, -0.5], index);
  const sway = at([0, 0.4, 0.8, 0.4], index);
  return {
    ...standingFrame(top, hanging(top, sway, -sway, index === 2 ? -0.4 : 0, index === 2 ? -0.4 : 0)),
    hemSway: sway * 0.5,
  };
}

function strideFeet(theta: number, facing: FacingName): readonly [Pt, Pt] {
  const dir = facing === 'front' ? 1 : -1;
  const foot = (phase: number, side: number): Pt => {
    const lift = 3.8 * Math.max(0, Math.cos(phase));
    return pt(CX + side * (HIP_X + 0.6) + 3 * Math.sin(phase), STAND_FOOT_Y - lift + 1.1 * dir * Math.sin(phase));
  };
  return [foot(theta, -1), foot(theta + Math.PI, 1)];
}

function walkFrame(index: number, facing: FacingName): FrameSpec {
  const theta = (index * Math.PI) / 4;
  const top = STAND_TORSO_TOP - 1.2 * Math.abs(Math.cos(theta));
  const [footL, footR] = strideFeet(theta, facing);
  // Arms swing against the same-side leg: the left arm follows the right leg.
  const swing = facing === 'front' ? -1 : 1;
  const [sl, sr] = shoulders(top);
  const armL: Limb = [sl, pt(sl.x - 1.8 + 1.4 * Math.sin(theta), top + 10.6 - swing * 3.2 * Math.sin(theta + Math.PI))];
  const armR: Limb = [sr, pt(sr.x + 1.8 - 1.4 * Math.sin(theta), top + 10.6 - swing * 3.2 * Math.sin(theta))];
  return { ...standingFrame(top, [armL, armR], standingLegs(footL, footR, STAND_HIP_Y - 0.6)), hemSway: 1.4 * Math.sin(theta) };
}

/** Walking with an envelope in both hands: the legs stride, the arms hold still. */
function carryFrame(index: number, facing: FacingName): FrameSpec {
  const theta = (index * Math.PI) / 4;
  const top = STAND_TORSO_TOP - 1.2 * Math.abs(Math.cos(theta));
  const [footL, footR] = strideFeet(theta, facing);
  const [sl, sr] = shoulders(top);
  const legs = standingLegs(footL, footR, STAND_HIP_Y - 0.6);
  const hemSway = 1.4 * Math.sin(theta);
  if (facing === 'front') {
    const arms: readonly [Limb, Limb] = [
      [sl, pt(sl.x - 1.2, top + 10), pt(CX - 4.6, top + 12.6)],
      [sr, pt(sr.x + 1.2, top + 10), pt(CX + 4.6, top + 12.6)],
    ];
    return { ...standingFrame(top, arms, legs), hemSway, carry: 'chest' };
  }
  const arms: readonly [Limb, Limb] = [
    [sl, pt(sl.x - 1.6, top + 10.6)],
    [sr, pt(sr.x + 1.4, top + 8.6), pt(sr.x + 2.6, top + 12.2)],
  ];
  return { ...standingFrame(top, arms, legs), hemSway, carry: 'side' };
}

/**
 * Thighs run sideways toward the facing side (the sprite is mirrored for the other
 * side), then the lower legs drop to the floor. The near leg sits lower and further out.
 */
function seatedLegs(): readonly [Limb, Limb] {
  const hipY = SEAT_HIP_Y;
  return [
    [pt(CX - 2, hipY), pt(CX + 11.6, hipY - 0.1), pt(CX + 12, SEAT_FOOT_Y - 0.8)],
    [pt(CX + 1.4, hipY + 2), pt(CX + 13.4, hipY + 1.9), pt(CX + 13.8, SEAT_FOOT_Y)],
  ];
}

function seatedFrame(top: number, arms: readonly [Limb, Limb], headDyExtra = 0): FrameSpec {
  return {
    torsoTop: top,
    torsoBottom: STAND_TORSO_BOTTOM + SEAT_DROP - 1.9,
    legs: seatedLegs(),
    arms,
    shoes: true,
    footDx: 0.4,
    seated: true,
    bodyDx: SEAT_BODY_DX,
    headDx: SEAT_BODY_DX,
    headDy: top - STAND_TORSO_TOP + headDyExtra,
  };
}

/** Forearms reach toward the desk: toward the camera when facing front, away when facing back. */
function typingArms(top: number, facing: FacingName, tapL: number, tapR: number): readonly [Limb, Limb] {
  const [sl, sr] = shoulders(top);
  if (facing === 'front') {
    const hy = top + 14.2;
    return [
      [sl, pt(sl.x - 2.2, top + 10), pt(CX - 4.4, hy + tapL)],
      [sr, pt(sr.x + 2.2, top + 10), pt(CX + 4.4, hy + tapR)],
    ];
  }
  return [
    [sl, pt(sl.x - 2.4, top + 8.4), pt(sl.x - 1.2, top + 4.4 + tapL)],
    [sr, pt(sr.x + 2.4, top + 8.4), pt(sr.x + 1.2, top + 4.4 + tapR)],
  ];
}

function typeFrame(index: number, facing: FacingName): FrameSpec {
  const top = STAND_TORSO_TOP + SEAT_DROP;
  const tapL = at([-1.8, -0.4, 0, -0.4], index);
  const tapR = at([0, -0.4, -1.8, -0.4], index);
  const nod = index === 1 || index === 3 ? 0.4 : 0;
  return seatedFrame(top, typingArms(top, facing, tapL, tapR), nod);
}

function sitFrame(index: number, facing: FacingName): FrameSpec {
  const top = STAND_TORSO_TOP + SEAT_DROP + (index === 1 ? -0.4 : 0);
  const [sl, sr] = shoulders(top);
  const arms: readonly [Limb, Limb] =
    facing === 'front'
      ? [
          [sl, pt(sl.x - 2.2, top + 10), pt(CX - 4.2, top + 14.4)],
          [sr, pt(sr.x + 2.2, top + 10), pt(CX + 4.2, top + 14.4)],
        ]
      : [
          [sl, pt(sl.x - 2.4, top + 8), pt(sl.x - 0.8, top + 11.2)],
          [sr, pt(sr.x + 2.4, top + 8), pt(sr.x + 0.8, top + 11.2)],
        ];
  return seatedFrame(top, arms);
}

/** Standing keyboard tap, used by interns that have no chair. */
function tapFrame(index: number, facing: FacingName): FrameSpec {
  const top = STAND_TORSO_TOP;
  const tapL = at([-1.8, -0.4, 0, -0.4], index);
  const tapR = at([0, -0.4, -1.8, -0.4], index);
  return standingFrame(top, typingArms(top, facing, tapL, tapR));
}

function talkFrame(index: number): FrameSpec {
  const top = STAND_TORSO_TOP + at([0, -0.4, 0, -0.4], index);
  const [sl, sr] = shoulders(top);
  const handY = at([top - 0.6, top - 3.4, top - 0.6, top + 1.4], index);
  const handX = sr.x + at([4.4, 4.8, 4.4, 3.8], index);
  const arms: readonly [Limb, Limb] = [
    [sl, pt(sl.x - 1.6, top + 11.2)],
    [sr, pt(sr.x + 4, top + 7), pt(handX, handY + 4)],
  ];
  return standingFrame(top, arms);
}

function waitFrame(index: number): FrameSpec {
  const top = STAND_TORSO_TOP + (index === 2 ? -0.4 : 0);
  const [sl, sr] = shoulders(top);
  const arms: readonly [Limb, Limb] = [
    [sl, pt(sl.x + 0.6, top + 9.6), pt(CX + 3.8, top + 8.4)],
    [sr, pt(sr.x - 0.6, top + 10.4), pt(CX - 3.8, top + 9.4)],
  ];
  const [fl, fr] = plantedFeet();
  const tap = index === 1 ? 2.6 : index === 2 ? 1 : 0;
  return standingFrame(top, arms, standingLegs(fl, pt(fr.x, fr.y - tap)));
}


function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Seated, fork travelling between the plate and the mouth; the head bobs while chewing. */
function eatFrame(index: number, facing: FacingName): FrameSpec {
  const top = STAND_TORSO_TOP + SEAT_DROP;
  const [sl, sr] = shoulders(top);
  const t = at([0, 0.45, 1, 1, 0.45, 0], index);
  const chew = at([0, 0, 0.3, 0.8, 0.2, 0], index);
  const front = facing === 'front';
  const plate = front ? pt(CX + 5, top + 14.4) : pt(sr.x + 0.8, top + 11.2);
  const hand = pt(lerp(plate.x, CX + 11.4, t), lerp(plate.y, top - 2, t));
  const elbow = pt(lerp(sr.x + 2.2, sr.x + 4.4, t), lerp(top + 10, top + 6.4, t));
  const left: Limb = front
    ? [sl, pt(sl.x - 2.2, top + 10), pt(CX - 4.2, top + 14.4)]
    : [sl, pt(sl.x - 2.4, top + 8), pt(sl.x - 0.8, top + 11.2)];
  const angle = lerp(1.85, 3.25, t);
  return { ...seatedFrame(top, [left, [sr, elbow, hand]], chew), prop: { kind: 'fork', angle, food: t < 0.6 } };
}

/** Standing, leaning over the table with both hands on the cue; the cue slides back and forth. */
function poolShootFrame(index: number): FrameSpec {
  const top = STAND_TORSO_TOP + 3.2;
  const [sl, sr] = shoulders(top);
  const slide = at([-2.4, -0.8, 2.2, 0.8], index);
  const ux = -0.95;
  const uy = 0.31;
  const tipP = pt(CX - 12.5 + ux * slide, top + 15.5 + uy * slide);
  const butt = pt(tipP.x - ux * 28, tipP.y - uy * 28);
  const grip = pt(butt.x + ux * 5, butt.y + uy * 5);
  const bridge = pt(CX - 7.8, top + 14.2);
  const arms: readonly [Limb, Limb] = [
    [sl, pt(sl.x - 1.2, top + 10), bridge],
    [sr, pt(sr.x + 2.4, top + 7.6), grip],
  ];
  const y = STAND_FOOT_Y;
  const legs = standingLegs(pt(CX - 8.4, y), pt(CX + 8, y));
  return { ...standingFrame(top, arms, legs), headDx: -1.6, prop: { kind: 'cue', from: butt, to: tipP } };
}

/** Standing with the cue planted upright beside the foot. */
function poolWaitFrame(index: number): FrameSpec {
  const top = STAND_TORSO_TOP + (index === 1 ? -0.4 : 0);
  const [sl, sr] = shoulders(top);
  const grip = pt(CX + 10, top + 7.2);
  const left: Limb = index === 0
    ? [sl, pt(sl.x - 1.6, top + 11.2)]
    : [sl, pt(sl.x - 3.2, top + 8.4), pt(CX - 5.4, top + 13.4)];
  const arms: readonly [Limb, Limb] = [left, [sr, pt(sr.x + 1.6, top + 8), grip]];
  const [fl, fr] = plantedFeet();
  const legs = index === 1 ? standingLegs(pt(fl.x + 1.4, fl.y), pt(fr.x + 0.6, fr.y)) : standingLegs(fl, fr);
  return {
    ...standingFrame(top, arms, legs),
    prop: { kind: 'cue', from: pt(CX + 11.2, STAND_FOOT_Y + 1), to: pt(CX + 9.4, 9) },
  };
}

/** Standing at the table, both hands on rod handles, wrists twisting in turn. */
function foosballFrame(index: number): FrameSpec {
  const top = STAND_TORSO_TOP + 1;
  const [sl, sr] = shoulders(top);
  const wobble = at([0, -1.4, 0, 1.4], index);
  const left: Limb = [sl, pt(sl.x - 2.8, top + 9.4), pt(CX - 6.6, top + 12 + wobble)];
  const right: Limb = [sr, pt(sr.x + 2.8, top + 9.4), pt(CX + 6.6, top + 12 - wobble)];
  const [fl, fr] = plantedFeet();
  const legs = standingLegs(pt(fl.x - 0.6, fl.y), pt(fr.x + 0.6, fr.y));
  return { ...standingFrame(top, [left, right], legs), prop: { kind: 'grips', phase: index } };
}

/** Seated with a pad held at the chest; the thumbs work the sticks and buttons. */
function consoleFrame(index: number, facing: FacingName): FrameSpec {
  const top = STAND_TORSO_TOP + SEAT_DROP;
  const [sl, sr] = shoulders(top);
  const twL = at([0, -0.8, 0.4, -0.3], index);
  const twR = at([-0.7, 0.3, -0.9, 0.2], index);
  const lean = at([0, 0.4, 0, 0.4], index);
  if (facing === 'front') {
    const arms: readonly [Limb, Limb] = [
      [sl, pt(sl.x - 1.6, top + 9), pt(CX - 4.8, top + 12.4 + twL)],
      [sr, pt(sr.x + 1.6, top + 9), pt(CX + 4.8, top + 12.4 + twR)],
    ];
    return { ...seatedFrame(top, arms, lean), prop: { kind: 'pad', phase: index } };
  }
  return seatedFrame(top, typingArms(top, 'back', twL, twR), lean);
}

/** Seated, sunk back: one hand in the lap, the other on the armrest; a slow breath and a head tilt. */
function loungeFrame(index: number, facing: FacingName): FrameSpec {
  const top = STAND_TORSO_TOP + SEAT_DROP + 1 + (index === 1 ? -0.4 : 0);
  const [sl, sr] = shoulders(top);
  const arms: readonly [Limb, Limb] =
    facing === 'front'
      ? [
          [sl, pt(sl.x - 1.8, top + 9), pt(CX - 3.8, top + 15.2)],
          [sr, pt(sr.x + 3.2, top + 8), pt(sr.x + 4.4, top + 14.2)],
        ]
      : [
          [sl, pt(sl.x - 3, top + 8), pt(sl.x - 2.2, top + 13.2)],
          [sr, pt(sr.x + 3, top + 8), pt(sr.x + 2.2, top + 13.2)],
        ];
  const frame = seatedFrame(top, arms, 0.5);
  return index === 1 ? { ...frame, headDx: frame.headDx + 0.9 } : frame;
}

export function buildFrame(pose: PoseName, facing: FacingName, index: number): FrameSpec {
  switch (pose) {
    case 'idle':
      return idleFrame(index);
    case 'walk':
      return walkFrame(index, facing);
    case 'type':
      return typeFrame(index, facing);
    case 'tap':
      return tapFrame(index, facing);
    case 'sit':
      return sitFrame(index, facing);
    case 'talk':
      return talkFrame(index);
    case 'wait':
      return waitFrame(index);
    case 'carry':
      return carryFrame(index, facing);
    case 'eat':
      return eatFrame(index, facing);
    case 'play-pool-shoot':
      return poolShootFrame(index);
    case 'play-pool-wait':
      return poolWaitFrame(index);
    case 'play-foosball':
      return foosballFrame(index);
    case 'play-console':
      return consoleFrame(index, facing);
    case 'lounge':
      return loungeFrame(index, facing);
  }
}

/** One cell of the atlas: which pose frame it holds and where the head sits in it. */
export interface FrameEntry {
  readonly pose: PoseName;
  readonly facing: FacingName;
  readonly index: number;
  readonly col: number;
  readonly row: number;
  /** Head centre offset from the standing head position, in figure units, before any mirroring. */
  readonly headDx: number;
  readonly headDy: number;
  readonly spec: FrameSpec;
}

/** Every frame of one atlas in order: facings outermost, then poses, then frame index. */
function buildTable(set: PoseSet): readonly FrameEntry[] {
  const table: FrameEntry[] = [];
  for (const facing of FACINGS) {
    for (const pose of SET_POSES[set]) {
      for (let index = 0; index < FRAME_COUNT[pose]; index += 1) {
        const slot = table.length;
        const spec = buildFrame(pose, facing, index);
        table.push({
          pose,
          facing,
          index,
          col: slot % ATLAS_COLS,
          row: Math.floor(slot / ATLAS_COLS),
          headDx: spec.headDx,
          headDy: spec.headDy,
          spec,
        });
      }
    }
  }
  return table;
}

export const FRAME_TABLE: readonly FrameEntry[] = buildTable('base');
export const ACTIVITY_TABLE: readonly FrameEntry[] = buildTable('activity');

export function frameTable(set: PoseSet): readonly FrameEntry[] {
  return set === 'base' ? FRAME_TABLE : ACTIVITY_TABLE;
}

const POSE_SLOT: ReadonlyMap<string, number> = new Map(
  [FRAME_TABLE, ACTIVITY_TABLE].flatMap((table) =>
    table.flatMap((entry, slot) => (entry.index === 0 ? [[`${entry.pose}:${entry.facing}`, slot] as const] : [])),
  ),
);

/** Position of a frame in its atlas's table (`frameTable(poseSet(pose))`); the cell is `slot % ATLAS_COLS`, `slot / ATLAS_COLS`. */
export function frameSlot(pose: PoseName, facing: FacingName, index: number): number {
  return (POSE_SLOT.get(`${pose}:${facing}`) ?? 0) + index;
}
