import {
  DataTexture,
  PlaneGeometry,
  RGBAFormat,
  RGFormat,
  type Texture,
  UnsignedByteType,
} from 'three';
import { GROUND_Y, FRAME_H } from './sprites/sprite.types';
import { characterLight } from './scene-light';
import { SpriteAtlas } from './sprites/atlas';

/** Starting light; the scene's daylight takes over through `characterLight`. */
const START_LIGHT: readonly [number, number, number] = [1.0, 0.97, 0.92];

/** What every character shares: sprite atlases, the quad geometry, the light and an empty texture. */
export class CharacterKit {
  readonly atlas = new SpriteAtlas();
  readonly geometry: PlaneGeometry;
  /** Shared uniform objects: updating `.value` here updates every character at once. */
  readonly light = characterLight;
  readonly heads: { value: Texture };
  readonly blankTint: DataTexture;
  readonly blankColour: DataTexture;

  constructor() {
    // Unit quad, x in -0.5..0.5, y from just below the soles (0 is the ground row) up to the frame top.
    const groundFraction = (FRAME_H - GROUND_Y) / FRAME_H;
    this.geometry = new PlaneGeometry(1, 1).translate(0, 0.5 - groundFraction, 0);
    this.heads = { value: this.atlas.headAtlas() };
    this.blankTint = new DataTexture(new Uint8Array(2), 1, 1, RGFormat, UnsignedByteType);
    this.blankTint.needsUpdate = true;
    this.blankColour = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
    this.blankColour.needsUpdate = true;
    this.light.value.set(...START_LIGHT);
  }

  dispose(): void {
    this.atlas.dispose();
    this.geometry.dispose();
    this.blankTint.dispose();
    this.blankColour.dispose();
  }
}
