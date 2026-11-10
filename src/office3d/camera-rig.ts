import { OrthographicCamera } from 'three';
import { DESK_SLOTS, KITCHEN_SPOTS, OFFICE, OFFICE_CORNERS } from './layout';
import { prefersReducedMotion } from '../reduced-motion';

/** True isometric elevation: atan(1 / sqrt 2). */
const PITCH = Math.atan(1 / Math.SQRT2);
const BASE_YAW = Math.PI / 4;
const DISTANCE = 90;
const FIT_MARGIN = 0.94;
const MAX_ZOOM = 150;
const MIN_ZOOM_RATIO = 0.45;
const PAN_MARGIN = 0.12;
const KEY_PAN_PX_PER_S = 620;
const ROTATE_SECONDS = 0.38;
/** Width the DOM legend takes on the right on wide screens; it moves to the bottom below 720px. */
const HUD_INSET = 300;
const HUD_BREAKPOINT = 720;
/** On phones the whole floor is tiny, so start zoomed until its height fills this share of the screen. */
const PHONE_FLOOR_HEIGHT_SHARE = 0.7;

export interface Heading {
  /** Horizontal unit vector from the office toward the camera. */
  readonly x: number;
  readonly z: number;
}

function headingOf(yaw: number): Heading {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function activeArea(): { x: number; z: number } {
  const points = [...KITCHEN_SPOTS, ...DESK_SLOTS.map((slot) => slot.desk)];
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
  };
}

/** Orthographic isometric camera: pan, zoom and 90 degree rotation over the office floor. */
export class CameraRig {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private width = 1;
  private height = 1;
  /** Pixels per metre on screen. */
  private zoom = 30;
  private fitZoom = 30;
  /** Zoom of the opening view: the whole office, or on phones the busy part of it. */
  private framedZoom = 30;
  private targetX = OFFICE.width / 2;
  private targetZ = OFFICE.depth / 2;
  private yaw = BASE_YAW;
  private yawFrom = BASE_YAW;
  private yawTo = BASE_YAW;
  private rotateElapsed = ROTATE_SECONDS;
  /** The view is the opening one (nothing panned or zoomed), so a turn re-centres the office. */
  private framed = false;
  private turnFrom: { x: number; z: number; zoom: number } | null = null;
  private turnTo: { x: number; z: number; zoom: number } | null = null;
  private dirty = true;

  /** Heading the camera is rotating toward; the cutaway follows this. */
  get targetHeading(): Heading {
    return headingOf(this.yawTo);
  }

  /** Heading right now, mid-turn included. */
  get shownHeading(): Heading {
    return headingOf(this.yaw);
  }

  /** Pixels per metre on screen right now. */
  get pixelsPerMetre(): number {
    return this.zoom;
  }

  /** Zoom relative to the opening view: 1 is where the camera starts, higher is closer. */
  get zoomRatio(): number {
    return this.zoom / this.framedZoom;
  }

  get isRotating(): boolean {
    return this.rotateElapsed < ROTATE_SECONDS;
  }

  /** Half-width of a ground square covering every allowed target and the widest ground projection. */
  get exteriorHalfExtent(): number {
    const minZoom = this.fitZoom * MIN_ZOOM_RATIO;
    const halfWidth = Math.max(Math.abs(this.camera.left), Math.abs(this.camera.right)) * this.zoom / minZoom;
    const halfHeight = Math.max(Math.abs(this.camera.top), Math.abs(this.camera.bottom)) * this.zoom / minZoom;
    const groundRadius = Math.hypot(halfWidth, halfHeight / Math.sin(PITCH));
    const panX = OFFICE.width * PAN_MARGIN;
    const panZ = OFFICE.depth * PAN_MARGIN;
    const targetRadius = Math.hypot(OFFICE.width / 2 + panX, OFFICE.depth / 2 + panZ);
    return targetRadius + groundRadius + 24;
  }

  resize(width: number, height: number): void {
    const first = this.width === 1;
    const ratio = this.fitZoom > 0 ? this.zoom / this.fitZoom : 1;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.computeFit();
    if (first) this.fit();
    else this.zoom = this.clampZoom(this.fitZoom * ratio);
    this.apply();
  }

  /** Frames the whole office, or the busy part of it on phones. */
  fit(): void {
    this.computeFit();
    if (this.width < HUD_BREAKPOINT) {
      this.zoom = this.framedZoom;
      const area = activeArea();
      this.targetX = area.x;
      this.targetZ = area.z;
    } else {
      this.zoom = this.framedZoom;
      const centre = this.centringTarget(this.yawTo);
      this.targetX = centre.x;
      this.targetZ = centre.z;
    }
    this.framed = this.width >= HUD_BREAKPOINT;
    this.clampTarget();
    this.apply();
  }

  /** Centres on a ground point at a zoom in pixels per metre (clamped); for close-ups. */
  focusOn(x: number, z: number, zoom: number): void {
    this.framed = false;
    this.targetX = x;
    this.targetZ = z;
    this.zoom = this.clampZoom(zoom);
    this.clampTarget();
    this.apply();
  }

  rotate(step: -1 | 1): void {
    this.yawFrom = this.yaw;
    this.yawTo += (step * Math.PI) / 2;
    this.turnFrom = null;
    this.turnTo = null;
    if (this.framed && this.width >= HUD_BREAKPOINT) {
      this.computeFit();
      const centre = this.centringTarget(this.yawTo);
      this.turnFrom = { x: this.targetX, z: this.targetZ, zoom: this.zoom };
      this.turnTo = { x: centre.x, z: centre.z, zoom: this.framedZoom };
    }
    if (prefersReducedMotion()) {
      if (this.turnTo !== null) this.applyTurn(1);
      this.yaw = this.yawTo;
      this.rotateElapsed = ROTATE_SECONDS;
      this.apply();
      return;
    }
    this.rotateElapsed = 0;
    this.dirty = true;
  }

  /** Drags the ground under the pointer by a screen delta in pixels. */
  dragBy(dx: number, dy: number): void {
    this.framed = false;
    const right = this.right();
    const fwd = this.forward();
    const k = 1 / (this.zoom * Math.sin(PITCH));
    this.targetX += -right.x * (dx / this.zoom) + fwd.x * dy * k;
    this.targetZ += -right.z * (dx / this.zoom) + fwd.z * dy * k;
    this.clampTarget();
    this.apply();
  }

  /** Zooms by a factor, keeping the ground point under (px, py) fixed. */
  zoomBy(factor: number, px = this.pivotX(), py = this.height / 2): void {
    const next = this.clampZoom(this.zoom * factor);
    if (next === this.zoom) return;
    this.framed = false;
    const right = this.right();
    const fwd = this.forward();
    const ox = px - this.pivotX();
    const oy = py - this.height / 2;
    const sinP = Math.sin(PITCH);
    const pointX = this.targetX + right.x * (ox / this.zoom) + fwd.x * (-oy / this.zoom / sinP);
    const pointZ = this.targetZ + right.z * (ox / this.zoom) + fwd.z * (-oy / this.zoom / sinP);
    this.zoom = next;
    this.targetX = pointX - right.x * (ox / next) - fwd.x * (-oy / next / sinP);
    this.targetZ = pointZ - right.z * (ox / next) - fwd.z * (-oy / next / sinP);
    this.clampTarget();
    this.apply();
  }

  /** Pans with held keys: (vx, vy) in -1..1 screen directions. */
  panKeys(vx: number, vy: number, deltaSeconds: number): void {
    if (vx === 0 && vy === 0) return;
    const px = KEY_PAN_PX_PER_S * deltaSeconds;
    this.dragBy(-vx * px, vy * px);
  }

  /** Advances the rotation ease; returns true while the camera moved this frame. */
  update(deltaSeconds: number): boolean {
    let moved = this.dirty;
    this.dirty = false;
    if (this.isRotating) {
      this.rotateElapsed = Math.min(ROTATE_SECONDS, this.rotateElapsed + deltaSeconds);
      const t = smoothstep(this.rotateElapsed / ROTATE_SECONDS);
      this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * t;
      this.applyTurn(t);
      this.apply();
      moved = true;
    }
    return moved;
  }

  /** Moves the framed view toward the target of the turn in progress. */
  private applyTurn(t: number): void {
    const from = this.turnFrom;
    const to = this.turnTo;
    if (from === null || to === null) return;
    this.targetX = from.x + (to.x - from.x) * t;
    this.targetZ = from.z + (to.z - from.z) * t;
    this.zoom = from.zoom + (to.zoom - from.zoom) * t;
  }

  /** Space the legend takes from the right edge; the target sits at the centre of what is left. */
  private inset(): number {
    return this.width > HUD_BREAKPOINT ? HUD_INSET : 0;
  }

  private pivotX(): number {
    return (this.width - this.inset()) / 2;
  }

  private right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Horizontal direction that appears as screen-up. */
  private forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  private clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(this.fitZoom * MIN_ZOOM_RATIO, zoom));
  }

  private clampTarget(): void {
    const mx = OFFICE.width * PAN_MARGIN;
    const mz = OFFICE.depth * PAN_MARGIN;
    this.targetX = Math.min(OFFICE.width + mx, Math.max(-mx, this.targetX));
    this.targetZ = Math.min(OFFICE.depth + mz, Math.max(-mz, this.targetZ));
  }

  /** Screen-space bounds in metres of the office (or just its floor) seen from `yaw`. */
  private extentAt(yaw: number, withWalls: boolean): { minX: number; maxX: number; minY: number; maxY: number } {
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const sinP = Math.sin(PITCH);
    const cosP = Math.cos(PITCH);
    const up = { x: -Math.sin(yaw) * sinP, y: cosP, z: -Math.cos(yaw) * sinP };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x = 0, z = 0] of OFFICE_CORNERS) {
      for (const y of withWalls ? [0, OFFICE.wallHeight] : [0]) {
        const sx = x * right.x + z * right.z;
        const sy = x * up.x + y * up.y + z * up.z;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
    }
    return { minX, maxX, minY, maxY };
  }

  /** Screen-space size in metres of the office box (or just its floor) from the current yaw. */
  private projectedExtent(withWalls: boolean): { width: number; height: number } {
    const e = this.extentAt(this.yawTo, withWalls);
    return { width: e.maxX - e.minX, height: e.maxY - e.minY };
  }

  /** The ground point that puts the middle of the office's silhouette at the middle of the view. */
  private centringTarget(yaw: number): { x: number; z: number } {
    const e = this.extentAt(yaw, true);
    const sinP = Math.sin(PITCH);
    const sx = (e.minX + e.maxX) / 2;
    const sy = (e.minY + e.maxY) / 2 - (OFFICE.wallHeight / 2) * Math.cos(PITCH);
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    return { x: right.x * sx + (fwd.x * sy) / sinP, z: right.z * sx + (fwd.z * sy) / sinP };
  }

  private computeFit(): void {
    const inset = this.inset();
    const extent = this.projectedExtent(true);
    this.fitZoom = Math.min((this.width - inset) / extent.width, this.height / extent.height) * FIT_MARGIN;
    if (this.width < HUD_BREAKPOINT) {
      const floorHeight = this.projectedExtent(false).height;
      this.framedZoom = this.clampZoom(Math.max(this.fitZoom, (this.height * PHONE_FLOOR_HEIGHT_SHARE) / floorHeight));
    } else {
      this.framedZoom = this.clampZoom(this.fitZoom);
    }
  }

  private apply(): void {
    const cam = this.camera;
    const halfH = this.height / 2 / this.zoom;
    cam.left = -this.pivotX() / this.zoom;
    cam.right = (this.width - this.pivotX()) / this.zoom;
    cam.top = halfH;
    cam.bottom = -halfH;
    const cosP = Math.cos(PITCH);
    cam.position.set(
      this.targetX + Math.sin(this.yaw) * cosP * DISTANCE,
      Math.sin(PITCH) * DISTANCE,
      this.targetZ + Math.cos(this.yaw) * cosP * DISTANCE,
    );
    cam.lookAt(this.targetX, 0, this.targetZ);
    cam.updateProjectionMatrix();
    this.dirty = true;
  }
}
