import { Character } from '../character';
import type { Vec2 } from '../layout.types';
import { Fade } from './fade';
import { Walker } from './walker';
import type { ActorContext } from './types';

const WALK_SPEED = 1.9;
const SCALE = 0.8;
const LINGER_MS = 700;
const FADE_MS = 400;
const POSTAL_BLUE = 0x5f8fd0;

/** A small postal-blue figure carrying an envelope from the mailroom to a desk, then fading out. */
export class Courier {
  readonly character: Character;
  private readonly walker = new Walker();
  private readonly fade = new Fade(1);
  private lingerLeft = -1;
  private faceX = 0;
  private faceZ = 1;
  private gone = false;

  constructor(
    private readonly ctx: ActorContext,
    private readonly onDone: () => void,
  ) {
    this.character = new Character(ctx.kit, SCALE);
    this.character.setReducedMotion(ctx.reducedMotion());
    this.character.setTint(POSTAL_BLUE);
    this.character.setFigure('male', 0);
    ctx.addBody(this.character);
  }

  get done(): boolean {
    return this.gone;
  }

  /** Walks `from` to `to` along the nav grid, faces `face`, lingers, fades and finishes. */
  deliver(from: Vec2, to: Vec2, face: Vec2): void {
    this.character.setPosition(from.x, from.z);
    const path = this.ctx.nav.findPath(from, to);
    this.faceX = face.x;
    this.faceZ = face.z;
    if (path === null) {
      // No route: hand the letter over where the courier stands instead of cutting through furniture.
      this.arrive();
      return;
    }
    if (this.ctx.reducedMotion()) {
      this.character.setPosition(to.x, to.z);
      this.arrive();
      return;
    }
    this.character.setPose('carry', WALK_SPEED);
    this.walker.start(path, WALK_SPEED);
  }

  update(deltaSeconds: number): boolean {
    let changed = false;
    if (this.walker.active) {
      changed = true;
      if (this.walker.advance(this.character, deltaSeconds)) this.arrive();
    }
    if (this.lingerLeft >= 0) {
      this.lingerLeft -= deltaSeconds * 1000;
      if (this.lingerLeft < 0) this.finish();
    }
    if (this.fade.update(deltaSeconds * 1000)) {
      this.character.setOpacity(this.fade.value);
      changed = true;
    }
    return changed;
  }

  destroy(): void {
    if (this.gone) return;
    this.gone = true;
    this.walker.stop();
    this.ctx.removeBody(this.character);
    this.character.dispose();
  }

  private arrive(): void {
    this.character.setFacing(this.faceX, this.faceZ);
    this.character.setPose('idle');
    this.lingerLeft = LINGER_MS;
  }

  private finish(): void {
    if (this.ctx.reducedMotion()) {
      this.onDone();
      this.destroy();
      return;
    }
    this.fade.ease(0, FADE_MS, () => {
      this.onDone();
      this.destroy();
    });
  }
}
