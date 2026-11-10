import type { Figure } from '../../office-contracts';

export type { Figure };

export type BasePoseName = 'idle' | 'walk' | 'type' | 'tap' | 'sit' | 'talk' | 'wait' | 'carry';
export type ActivityPoseName = 'eat' | 'play-pool-shoot' | 'play-pool-wait' | 'play-foosball' | 'play-console' | 'lounge';
export type PoseName = BasePoseName | ActivityPoseName;
/** Base poses live in the main atlas; activity poses in a second atlas made the first time one is used. */
export type PoseSet = 'base' | 'activity';
export type FacingName = 'front' | 'back';

export const POSES: readonly BasePoseName[] = ['idle', 'walk', 'type', 'tap', 'sit', 'talk', 'wait', 'carry'];
export const ACTIVITY_POSES: readonly ActivityPoseName[] = [
  'eat',
  'play-pool-shoot',
  'play-pool-wait',
  'play-foosball',
  'play-console',
  'lounge',
];
export const SET_POSES: Readonly<Record<PoseSet, readonly PoseName[]>> = { base: POSES, activity: ACTIVITY_POSES };

export function poseSet(pose: PoseName): PoseSet {
  return (ACTIVITY_POSES as readonly PoseName[]).includes(pose) ? 'activity' : 'base';
}

export const FACINGS: readonly FacingName[] = ['front', 'back'];
export const DRESS_VARIANTS = 3;

/** Frame size in figure units (the unit every pose and painter works in). */
export const FRAME_W = 32;
export const FRAME_H = 48;
/** Baked pixels per figure unit: a frame is 96 x 144 px, about 106 px per metre. */
export const PX = 3;
/** Row of the sole of the feet inside a frame. */
export const GROUND_Y = 46;
/** Row of the head centre inside a standing frame. */
export const HEAD_CENTER_Y = 13;
export const HEAD_SIZE = 20;

export const FRAME_COUNT: Readonly<Record<PoseName, number>> = {
  idle: 4,
  walk: 8,
  type: 4,
  tap: 4,
  sit: 2,
  talk: 4,
  wait: 4,
  carry: 8,
  eat: 6,
  'play-pool-shoot': 4,
  'play-pool-wait': 2,
  'play-foosball': 4,
  'play-console': 4,
  lounge: 2,
};

/** Base frame rates (frames per second); walk and carry are scaled to the ground speed. */
export const FRAME_RATE: Readonly<Record<PoseName, number>> = {
  idle: 3,
  walk: 11.5,
  type: 8,
  tap: 8,
  sit: 1.5,
  talk: 6,
  wait: 4,
  carry: 11.5,
  eat: 3.5,
  'play-pool-shoot': 3,
  'play-pool-wait': 1.2,
  'play-foosball': 7,
  'play-console': 5,
  lounge: 1,
};

/** Ground distance of one full stride (two steps) in metres; the walk cycle plays one stride per this distance. */
export const STRIDE_METRES = 1.1;

/** Atlas layout shared by every sheet: 16 columns by 5 rows of frames, 1536 x 720 px. */
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 5;
/** Rows of the activity atlas: 44 frames (22 per facing) fit in 3 rows of 16. */
export const ACTIVITY_ATLAS_ROWS = 3;
export const CELL_W = FRAME_W * PX;
export const CELL_H = FRAME_H * PX;
export const ATLAS_W = ATLAS_COLS * CELL_W;

export function atlasHeight(set: PoseSet): number {
  return (set === 'base' ? ATLAS_ROWS : ACTIVITY_ATLAS_ROWS) * CELL_H;
}

/** Plain-head atlas: four 28 x 32 unit cells (male front/back, female front/back) in a 256 x 256 texture. */
export const HEAD_CELL_W = 28;
export const HEAD_CELL_H = 32;
export const HEAD_CELL_CENTER = { x: 14, y: 14 } as const;
export const HEAD_ATLAS_SIZE = 256;

export type SheetKind =
  | 'legs-male'
  | 'legs-bare'
  | 'hands'
  | 'upper-male'
  | 'dress-0'
  | 'dress-1'
  | 'dress-2'
  | 'accent';

export function dressSheet(variant: number): SheetKind {
  const index = ((variant % DRESS_VARIANTS) + DRESS_VARIANTS) % DRESS_VARIANTS;
  return index === 0 ? 'dress-0' : index === 1 ? 'dress-1' : 'dress-2';
}
