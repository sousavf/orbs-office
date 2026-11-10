import { type Camera, Vector3 } from 'three';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Projects world points to pixels of the canvas, for overlays and picking. Call `begin` once a frame. */
export class Projector {
  private readonly scratch = new Vector3();
  private width = 1;
  private height = 1;
  private left = 0;
  private top = 0;
  private rectStale = true;

  constructor(
    private readonly camera: Camera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  /** Marks the cached canvas box stale; call when the canvas may have moved or resized. */
  invalidate(): void {
    this.rectStale = true;
  }

  /** Syncs with the camera and the canvas box. The box is re-read only after `invalidate`, so a frame never forces layout. */
  begin(): void {
    this.camera.updateMatrixWorld();
    if (!this.rectStale) return;
    this.rectStale = false;
    const box = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, box.width);
    this.height = Math.max(1, box.height);
    this.left = box.left;
    this.top = box.top;
  }

  /** Pixels from the canvas's top-left corner. */
  toLocal(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    this.scratch.set(x, y, z).project(this.camera);
    out.x = (this.scratch.x * 0.5 + 0.5) * this.width;
    out.y = (-this.scratch.y * 0.5 + 0.5) * this.height;
    return out;
  }

  /** Viewport (client) pixels, as the HUD and popup want them. */
  toClient(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    this.toLocal(x, y, z, out);
    out.x += this.left;
    out.y += this.top;
    return out;
  }

  toLocalFromClient(clientX: number, clientY: number, out: ScreenPoint): ScreenPoint {
    out.x = clientX - this.left;
    out.y = clientY - this.top;
    return out;
  }

  get viewWidth(): number {
    return this.width;
  }

  get viewHeight(): number {
    return this.height;
  }
}
