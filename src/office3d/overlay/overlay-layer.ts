import { BotOverlay } from './bot-overlay';
import { ensureOverlayStyles } from './overlay-styles';
import { type Projector, type ScreenPoint } from './projector';

const OFFSCREEN_MARGIN = 160;

/** One DOM layer over the canvas that holds every character's labels and bubbles. */
export class OverlayLayer {
  private readonly root = document.createElement('div');
  private readonly overlays = new Set<BotOverlay>();
  private readonly point: ScreenPoint = { x: 0, y: 0 };

  constructor(
    container: HTMLElement,
    private readonly projector: Projector,
    private readonly onReplyClick: (botId: string) => void,
  ) {
    ensureOverlayStyles();
    this.root.className = 'o3-layer';
    this.root.dataset.layer = 'characters';
    container.append(this.root);
  }

  get nodeCount(): number {
    return this.root.querySelectorAll('*').length + 1;
  }

  create(botId: string, compact = false): BotOverlay {
    const overlay = new BotOverlay({ botId, compact, onReplyClick: this.onReplyClick });
    this.overlays.add(overlay);
    this.root.append(overlay.root);
    return overlay;
  }

  remove(overlay: BotOverlay): void {
    this.overlays.delete(overlay);
    overlay.destroy();
  }

  /** Re-projects every stack. Call after the projector's `begin`. */
  update(): void {
    const width = this.projector.viewWidth;
    const height = this.projector.viewHeight;
    for (const overlay of this.overlays) {
      this.projector.toLocal(overlay.anchorX, overlay.anchorY, overlay.anchorZ, this.point);
      const { x, y } = this.point;
      const visible =
        x > -OFFSCREEN_MARGIN && x < width + OFFSCREEN_MARGIN && y > -OFFSCREEN_MARGIN && y < height + OFFSCREEN_MARGIN * 2;
      overlay.place(x, y, visible, width);
    }
  }

  dispose(): void {
    this.overlays.clear();
    this.root.remove();
  }
}
