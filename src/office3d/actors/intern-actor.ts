import type { BotActivity } from '../../feed/office.types';
import { Character, type Figure } from '../character';
import type { Vec2 } from '../layout.types';
import type { BotOverlay } from '../overlay/bot-overlay';
import { dressSeed } from '../sprites/dress-colors';
import { Fade } from './fade';
import { mixWithWhite, truncate } from './support';
import { type ActorContext, bubbleFor, isWorking } from './types';

const SCALE = 0.7;
const FADE_MS = 220;
const NAME_MAX = 12;
const HEAD_HEIGHT = 1.45 * SCALE;

/** A subagent: a smaller, lighter copy of its parent standing beside the desk. */
export class InternActor {
  readonly character: Character;
  private readonly overlay: BotOverlay;
  private readonly fade = new Fade(1);
  private gone = false;

  constructor(
    private readonly ctx: ActorContext,
    botId: string,
    private readonly internId: string,
  ) {
    this.character = new Character(ctx.kit, SCALE);
    this.character.setReducedMotion(ctx.reducedMotion());
    ctx.addBody(this.character);
    this.overlay = ctx.overlays.create(`${botId}/${internId}`, true);
    this.overlay.setLabelShown(false);
  }

  get done(): boolean {
    return this.gone;
  }

  setIdentity(name: string | null, color: number, figure: Figure): this {
    this.overlay.setName(truncate(name ?? 'Subagent', NAME_MAX));
    this.character.setTint(mixWithWhite(color, 0.45));
    this.character.setFigure(figure, dressSeed(this.internId));
    return this;
  }

  setLabelShown(shown: boolean): void {
    this.overlay.setLabelShown(shown);
  }

  setActivity(activity: BotActivity): this {
    this.character.setPose(isWorking(activity) ? 'tap' : 'idle');
    this.overlay.setBadge(bubbleFor(activity), !this.ctx.reducedMotion());
    return this;
  }

  /** Stands at `pos` looking along `face` (toward the parent's desk). */
  placeAt(pos: Vec2, face: Vec2): this {
    this.character.setPosition(pos.x, pos.z);
    this.character.setFacing(face.x, face.z);
    this.syncOverlay();
    return this;
  }

  appear(): this {
    if (this.ctx.reducedMotion()) return this;
    this.fade.value = 0;
    this.fade.ease(1, FADE_MS);
    this.applyFade();
    return this;
  }

  leave(): void {
    if (this.ctx.reducedMotion()) {
      this.destroy();
      return;
    }
    this.fade.ease(0, FADE_MS, () => this.destroy());
  }

  /** Advances the fade; returns true while something on screen changed. */
  update(deltaSeconds: number): boolean {
    if (!this.fade.update(deltaSeconds * 1000)) return false;
    this.applyFade();
    return true;
  }

  destroy(): void {
    if (this.gone) return;
    this.gone = true;
    this.ctx.removeBody(this.character);
    this.character.dispose();
    this.ctx.overlays.remove(this.overlay);
  }

  private applyFade(): void {
    this.character.setOpacity(this.fade.value);
    this.overlay.setOpacity(this.fade.value);
  }

  private syncOverlay(): void {
    this.overlay.anchorX = this.character.x;
    this.overlay.anchorY = HEAD_HEIGHT;
    this.overlay.anchorZ = this.character.z;
  }
}
