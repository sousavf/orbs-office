import { Color, Mesh, ShaderMaterial, type Texture, Vector2, Vector3, Vector4 } from 'three';
import { CHARACTER_FRAGMENT, CHARACTER_VERTEX } from './character-shader';
import type { CharacterKit } from './character-kit';
import { shade } from './palette';
import { frameRects } from './sprites/atlas';
import { dressColors } from './sprites/dress-colors';
import { frameSlot, frameTable } from './sprites/poses';
import {
  DRESS_VARIANTS,
  FRAME_COUNT,
  FRAME_RATE,
  FRAME_W,
  FRAME_H,
  type FacingName,
  type Figure,
  HEAD_CENTER_Y,
  type PoseName,
  STRIDE_METRES,
  dressSheet,
  poseSet,
} from './sprites/sprite.types';
import { headCell } from './sprites/heads';

export type { Figure, PoseName };

/** Metres per figure unit: a 48 unit frame is 1.36 m, the standing figure 1.3 m from soles to hair. */
const UNIT_METRES = 0.0283;
/** The camera looks down at atan(1 / sqrt 2); an upright quad is stretched by 1 / cos(pitch) so the sprite keeps its shape on screen. */
const FORESHORTENING = 1 / Math.cos(Math.atan(1 / Math.SQRT2));
/** Pulls a seated figure's quad toward the camera in depth only, so the chair does not slice through it. */
const SEATED_BIAS = 0.3;
/** Standing and walking figures get just enough to keep their feet off the floor; tables and walls in front still hide them. */
const STANDING_BIAS = 0.04;
const SIDE_EPSILON = 0.12;
const FIGURE_CENTER_X = FRAME_W / 2;

const TINT_FALLBACK = 0xa8b0c8;

function placeholderTexture(texture: Texture): { value: Texture } {
  return { value: texture };
}

/**
 * A chibi figure as one camera-facing quad. Legs, shirt or dress, accent, hands and head are
 * composited in the fragment shader from shared sprite atlases, so a character is a single draw
 * with its own few uniforms.
 */
export class Character {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly legsU: { value: Texture };
  private readonly upperU: { value: Texture };
  private readonly accentU: { value: Texture };
  private readonly handsU: { value: Texture };
  private readonly avatarU: { value: Texture };
  private readonly rect = new Vector4();
  private readonly headRect = new Vector4();
  private readonly head = new Vector3(FIGURE_CENTER_X, HEAD_CENTER_Y, 0);
  private readonly flipU = { value: 0 };
  private readonly opacityU = { value: 1 };
  private readonly biasU = { value: STANDING_BIAS };
  private readonly accentOnU = { value: 0 };
  private readonly tint = new Color(TINT_FALLBACK);
  private readonly accentTint = new Color(TINT_FALLBACK);
  private readonly ring = new Color(0x2c313c);

  private pose: PoseName = 'idle';
  private figure: Figure = 'male';
  private dressSeed = 0;
  private botColor = TINT_FALLBACK;
  private facingX = 0;
  private facingZ = 1;
  private viewX = 0;
  private viewZ = 1;
  private towardCamera = false;
  private back = false;
  private flipped = false;
  private reduced = false;
  private rate = FRAME_RATE.idle;
  private clock = 0;
  private frame = 0;
  private visualDirty = true;
  private viewDirty = true;
  private sheetsDirty = true;
  private avatar: Texture | null = null;

  constructor(
    private readonly kit: CharacterKit,
    /** Size relative to a grown-up figure; interns and couriers are smaller. */
    readonly scale = 1,
  ) {
    const blankTint = kit.blankTint;
    const blankColour = kit.blankColour;
    this.legsU = placeholderTexture(blankColour);
    this.upperU = placeholderTexture(blankTint);
    this.accentU = placeholderTexture(blankTint);
    this.handsU = placeholderTexture(blankColour);
    this.avatarU = placeholderTexture(blankColour);
    this.material = new ShaderMaterial({
      vertexShader: CHARACTER_VERTEX,
      fragmentShader: CHARACTER_FRAGMENT,
      uniforms: {
        uLegs: this.legsU,
        uUpper: this.upperU,
        uAccent: this.accentU,
        uHands: this.handsU,
        uHeads: kit.heads,
        uAvatar: this.avatarU,
        uRect: { value: this.rect },
        uHeadRect: { value: this.headRect },
        uHead: { value: this.head },
        uFlip: this.flipU,
        uOpacity: this.opacityU,
        uAccentOn: this.accentOnU,
        uTint: { value: this.tint },
        uAccentTint: { value: this.accentTint },
        uRing: { value: this.ring },
        uLight: kit.light,
        uSize: { value: new Vector2(FRAME_W * UNIT_METRES * scale, FRAME_H * UNIT_METRES * FORESHORTENING * scale) },
        uBias: this.biasU,
      },
      alphaToCoverage: true,
      toneMapped: true,
    });
    this.biasU.value = STANDING_BIAS * scale;
    this.mesh = new Mesh(kit.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = true;
    this.applyFigure();
    this.applyFrame();
  }

  setPosition(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }

  /** Raises the figure off the floor, for a chair seat. */
  setLift(y: number): void {
    this.mesh.position.y = y;
  }

  /** A seated figure is drawn in front of its chair; anyone else sorts against furniture by their real position. */
  setSeated(seated: boolean): void {
    this.biasU.value = (seated ? SEATED_BIAS : STANDING_BIAS) * this.scale;
  }

  /** The pose being played; for debugging and tests. */
  get currentPose(): PoseName {
    return this.pose;
  }

  get x(): number {
    return this.mesh.position.x;
  }

  get z(): number {
    return this.mesh.position.z;
  }

  /**
   * Plays `pose`. Walk and carry tie their frame rate to `speed` (metres per second);
   * other poses use their fixed rate.
   */
  setPose(pose: PoseName, speed = 0): void {
    const stride = pose === 'walk' || pose === 'carry';
    const rate = stride && speed > 0 ? (speed / STRIDE_METRES) * FRAME_COUNT[pose] : FRAME_RATE[pose];
    if (pose !== this.pose) {
      const switchSheets = poseSet(pose) !== poseSet(this.pose);
      this.pose = pose;
      if (switchSheets) this.applySheets();
      this.clock = 0;
      this.frame = 0;
      this.visualDirty = true;
    }
    this.rate = rate;
  }

  /** World-space direction the figure looks or moves in (x east, z south). */
  setFacing(dx: number, dz: number): void {
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) return;
    this.facingX = dx / length;
    this.facingZ = dz / length;
    this.towardCamera = false;
    this.viewDirty = true;
  }

  /** Looks at the camera whatever its heading, until the next `setFacing`. */
  faceCamera(): void {
    if (this.towardCamera) return;
    this.towardCamera = true;
    this.viewDirty = true;
  }

  /** 0..1; fades the whole figure (it is composited in one pass, so parts never show through each other). */
  setOpacity(opacity: number): void {
    this.opacityU.value = opacity;
  }

  get opacity(): number {
    return this.opacityU.value;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** Camera heading: the horizontal unit vector pointing from the office toward the camera. */
  setView(headingX: number, headingZ: number): void {
    if (Math.abs(headingX - this.viewX) < 1e-4 && Math.abs(headingZ - this.viewZ) < 1e-4) return;
    this.viewX = headingX;
    this.viewZ = headingZ;
    this.viewDirty = true;
  }

  setTint(color: number): void {
    this.botColor = color;
    this.applyTint();
  }

  /** Figure and a stable per-bot seed that picks the dress pattern and colour. */
  setFigure(figure: Figure, dressSeed = this.dressSeed): void {
    if (figure === this.figure && dressSeed === this.dressSeed && !this.sheetsDirty) return;
    this.figure = figure;
    this.dressSeed = dressSeed;
    this.applyFigure();
  }

  /** Shows the avatar as the face, or the plain head when there is none. The character does not own the texture. */
  setHead(texture: Texture | null): void {
    if (texture === this.avatar) return;
    this.avatar = texture;
    this.avatarU.value = texture ?? this.kit.blankColour;
    this.head.z = texture === null ? 0 : 1;
    this.visualDirty = true;
  }

  setReducedMotion(reduced: boolean): void {
    if (reduced === this.reduced) return;
    this.reduced = reduced;
    if (reduced) {
      this.frame = 0;
      this.clock = 0;
    }
    this.visualDirty = true;
  }

  /** Advances the animation; returns true when something the camera sees changed. */
  update(deltaSeconds: number): boolean {
    let changed = false;
    if (this.viewDirty) {
      this.viewDirty = false;
      this.resolveView();
    }
    if (!this.reduced) {
      const count = FRAME_COUNT[this.pose];
      if (count > 1 && this.rate > 0) {
        this.clock += deltaSeconds * this.rate;
        const next = Math.floor(this.clock) % count;
        if (this.clock > 1e6) this.clock = next;
        if (next !== this.frame) {
          this.frame = next;
          this.visualDirty = true;
        }
      }
    }
    if (this.visualDirty) {
      this.visualDirty = false;
      this.applyFrame();
      changed = true;
    }
    return changed;
  }

  dispose(): void {
    this.material.dispose();
  }

  private resolveView(): void {
    if (this.towardCamera) {
      if (this.back || this.flipped) {
        this.back = false;
        this.flipped = false;
        this.visualDirty = true;
      }
      return;
    }
    // Camera right is (hz, -hx); the figure is "in front" when it looks toward the camera.
    const toward = this.facingX * this.viewX + this.facingZ * this.viewZ;
    const side = this.facingX * this.viewZ - this.facingZ * this.viewX;
    const back = Math.abs(toward) > SIDE_EPSILON ? toward < 0 : this.back;
    const flipped = Math.abs(side) > SIDE_EPSILON ? side < 0 : this.flipped;
    if (back !== this.back || flipped !== this.flipped) {
      this.back = back;
      this.flipped = flipped;
      this.visualDirty = true;
    }
  }

  private applyTint(): void {
    if (this.figure === 'male') {
      this.tint.setHex(this.botColor);
      return;
    }
    const colors = dressColors(this.botColor, this.dressSeed);
    this.tint.setHex(colors.dress);
    this.accentTint.setHex(colors.accent);
    this.ring.setHex(shade(this.botColor, 0.55));
  }

  /** Points the sheet uniforms at the atlas that holds the current pose (the activity atlas is made on first use). */
  private applySheets(): void {
    const atlas = this.kit.atlas;
    const set = poseSet(this.pose);
    const female = this.figure === 'female';
    this.legsU.value = atlas.sheet(female ? 'legs-bare' : 'legs-male', set);
    this.upperU.value = atlas.sheet(female ? dressSheet(this.dressSeed % DRESS_VARIANTS) : 'upper-male', set);
    this.accentU.value = female ? atlas.sheet('accent', set) : this.kit.blankTint;
    this.handsU.value = atlas.sheet('hands', set);
    this.accentOnU.value = female ? 1 : 0;
  }

  private applyFigure(): void {
    this.applySheets();
    this.sheetsDirty = false;
    this.applyTint();
    this.ring.setHex(shade(this.botColor, 0.55));
    this.visualDirty = true;
  }

  private applyFrame(): void {
    const facing: FacingName = this.back ? 'back' : 'front';
    const slot = frameSlot(this.pose, facing, this.frame);
    const set = poseSet(this.pose);
    const entry = frameTable(set)[slot];
    this.rect.fromArray(frameRects(set), slot * 4);
    const cell = headCell(this.figure, facing);
    this.headRect.set(cell.u, cell.v, cell.du, cell.dv);
    this.flipU.value = this.flipped ? 1 : 0;
    const dx = entry?.headDx ?? 0;
    this.head.x = FIGURE_CENTER_X + (this.flipped ? -dx : dx);
    this.head.y = HEAD_CENTER_Y + (entry?.headDy ?? 0);
  }
}
