import type { CameraRig } from './camera-rig';

const WHEEL_SENSITIVITY = 0.0016;
const KEY_ZOOM_STEP = 1.2;
const LINE_HEIGHT_PX = 16;

const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

interface Point {
  x: number;
  y: number;
}

/** Wires pointer drag, pinch, wheel and keyboard to the camera rig. */
export class CameraInput {
  private readonly pointers = new Map<number, Point>();
  private readonly held = new Set<string>();
  private pinchDistance = 0;

  constructor(
    private readonly surface: HTMLElement,
    private readonly rig: CameraRig,
    private readonly requestFrame: () => void,
  ) {
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerEnd);
    surface.addEventListener('pointercancel', this.onPointerEnd);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Per-frame held-arrow panning. Returns true if the camera moved. */
  tick(deltaSeconds: number): boolean {
    let vx = 0;
    let vy = 0;
    for (const key of this.held) {
      const dir = PAN_KEYS[key];
      if (dir === undefined) continue;
      vx += dir[0];
      vy += dir[1];
    }
    if (vx === 0 && vy === 0) return false;
    this.rig.panKeys(vx, vy, deltaSeconds);
    return true;
  }

  get isPanning(): boolean {
    return this.held.size > 0;
  }

  dispose(): void {
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerEnd);
    this.surface.removeEventListener('pointercancel', this.onPointerEnd);
    this.surface.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private local(event: PointerEvent | WheelEvent): Point {
    const rect = this.surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.surface.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, this.local(event));
    this.pinchDistance = 0;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (previous === undefined) return;
    const current = this.local(event);
    this.pointers.set(event.pointerId, current);
    if (this.pointers.size >= 2) {
      this.pinch();
    } else {
      this.rig.dragBy(current.x - previous.x, current.y - previous.y);
    }
    this.requestFrame();
  };

  private pinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (a === undefined || b === undefined) return;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinchDistance > 0 && distance > 0) {
      this.rig.zoomBy(distance / this.pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    this.pinchDistance = distance;
  }

  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.pinchDistance = 0;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT_PX : event.deltaY;
    const point = this.local(event);
    this.rig.zoomBy(Math.exp(-pixels * WHEEL_SENSITIVITY), point.x, point.y);
    this.requestFrame();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key in PAN_KEYS) {
      this.held.add(event.key);
      event.preventDefault();
      this.requestFrame();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === '+' || key === '=') this.rig.zoomBy(KEY_ZOOM_STEP);
    else if (key === '-' || key === '_') this.rig.zoomBy(1 / KEY_ZOOM_STEP);
    else if (key === '0') this.rig.fit();
    else if (key === 'q') this.rig.rotate(-1);
    else if (key === 'e') this.rig.rotate(1);
    else return;
    this.requestFrame();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.key);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
  };
}
