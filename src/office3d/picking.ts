import type { PickTarget } from './actors/types';
import type { Projector, ScreenPoint } from './overlay/projector';

/** A press that moves farther than this is a camera drag, not a click. */
const CLICK_DISTANCE = 6;
/** Half-width of the hit capsule, in metres, and its floor in pixels so far-zoomed figures stay easy to hit. */
const HIT_RADIUS_M = 0.3;
const MIN_RADIUS_PX = 11;
const TOUCH_RADIUS_PX = 20;

export interface PickHandlers {
  /** The bot under a mouse pointer, or null. */
  onHover(botId: string | null): void;
  /** A click (or tap) on a bot, or on empty floor when null. */
  onClick(botId: string | null): void;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Hover and click on characters. Each figure is a capsule from its soles to its hair, projected to
 * the screen; the figure lowest on screen (nearest the camera) wins an overlap. Only presses that
 * start on the canvas count, so releases that began on the legend or popup never click the floor.
 */
export class Picker {
  private readonly feet: ScreenPoint = { x: 0, y: 0 };
  private readonly top: ScreenPoint = { x: 0, y: 0 };
  private readonly local: ScreenPoint = { x: 0, y: 0 };
  private downAt: { x: number; y: number; id: number } | null = null;
  private hovered: string | null = null;
  private pendingMove: { x: number; y: number } | null = null;
  private moveFrame = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly projector: Projector,
    private readonly targets: () => Iterable<PickTarget>,
    private readonly pixelsPerMetre: () => number,
    private readonly handlers: PickHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('pointerleave', this.onLeave);
  }

  /** The bot at a viewport point, or null. */
  pick(clientX: number, clientY: number, touch = false): string | null {
    this.projector.begin();
    const point = this.projector.toLocalFromClient(clientX, clientY, this.local);
    const radius = Math.max(touch ? TOUCH_RADIUS_PX : MIN_RADIUS_PX, HIT_RADIUS_M * this.pixelsPerMetre());
    let best: string | null = null;
    let bestDepth = -Infinity;
    for (const target of this.targets()) {
      this.projector.toLocal(target.x, target.y, target.z, this.feet);
      this.projector.toLocal(target.x, target.y + target.height, target.z, this.top);
      if (distanceToSegment(point.x, point.y, this.feet.x, this.feet.y - radius, this.top.x, this.top.y + radius) > radius) continue;
      if (this.feet.y > bestDepth) {
        bestDepth = this.feet.y;
        best = target.id;
      }
    }
    return best;
  }

  dispose(): void {
    cancelAnimationFrame(this.moveFrame);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.style.cursor = '';
  }

  private setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.canvas.style.cursor = id === null ? '' : 'pointer';
    this.handlers.onHover(id);
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this.downAt !== null && this.downAt.id !== event.pointerId) {
      this.downAt = null;
      return;
    }
    this.downAt = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    if (event.buttons !== 0) {
      this.pendingMove = null;
      this.setHovered(null);
      return;
    }
    // Hit-testing waits for the next frame, so a burst of pointer events costs one pass.
    this.pendingMove = { x: event.clientX, y: event.clientY };
    if (this.moveFrame === 0) this.moveFrame = requestAnimationFrame(this.flushMove);
  };

  private readonly flushMove = (): void => {
    this.moveFrame = 0;
    const move = this.pendingMove;
    this.pendingMove = null;
    if (move !== null) this.setHovered(this.pick(move.x, move.y));
  };

  private readonly onUp = (event: PointerEvent): void => {
    const down = this.downAt;
    this.downAt = null;
    if (down === null || down.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) >= CLICK_DISTANCE) return;
    this.handlers.onClick(this.pick(event.clientX, event.clientY, event.pointerType === 'touch'));
  };

  private readonly onCancel = (): void => {
    this.downAt = null;
  };

  private readonly onLeave = (): void => {
    this.pendingMove = null;
    this.setHovered(null);
  };
}
