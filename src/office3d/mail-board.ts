import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { OfficeState } from '../feed/office.types';
import { upcomingRoutines } from '../feed/office-selectors';
import { formatOfficeClock } from '../office-clock';
import { truncate } from './actors/support';
import { OFFICE } from './layout-rooms';

const LINES = 3;
const NAME_MAX = 12;
const BOARD = { width: 1.2, height: 0.95, depth: 0.05 } as const;
const FACE_MARGIN = 0.04;
/** Mounted on the mailroom's north wall (the wall at z = 12), right of the pigeonholes. */
const POSITION = { x: 6.35, y: 1.7, z: 12 } as const;
/** The board is on a wall that faces +z, so it shows while the camera looks at it from that side. */
const WALL_NORMAL_Z = 1;
const VISIBLE_DOT = 0.3;
const PX_PER_METRE = 500;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Notice board on the mailroom wall listing the next routines; redrawn only when the list changes. */
export class MailBoard {
  readonly group = new Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly face: MeshBasicMaterial;
  private readonly frame: MeshBasicMaterial;
  private readonly geometry: BoxGeometry;
  private readonly facePlane: PlaneGeometry;
  private lines: readonly string[] = [];
  private signature = '';

  constructor() {
    const faceWidth = BOARD.width - FACE_MARGIN * 2;
    const faceHeight = BOARD.height - FACE_MARGIN * 2;
    this.canvas.width = Math.round(faceWidth * PX_PER_METRE);
    this.canvas.height = Math.round(faceHeight * PX_PER_METRE);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.face = new MeshBasicMaterial({ map: this.texture as Texture, toneMapped: false });
    this.frame = new MeshBasicMaterial({ color: 0x7a8594, toneMapped: false });
    this.geometry = new BoxGeometry(BOARD.width, BOARD.height, BOARD.depth);
    this.facePlane = new PlaneGeometry(faceWidth, faceHeight);
    const frame = new Mesh(this.geometry, this.frame);
    const face = new Mesh(this.facePlane, this.face);
    face.position.z = BOARD.depth / 2 + 0.002;
    this.group.add(frame, face);
    this.group.position.set(POSITION.x, POSITION.y, POSITION.z + OFFICE.wallThickness / 2 + BOARD.depth / 2);
    this.group.name = 'mail-board';
    this.draw();
  }

  /** Shows the board only while the camera looks at its wall. */
  setHeading(headingZ: number): void {
    this.group.visible = headingZ * WALL_NORMAL_Z > VISIBLE_DOT;
  }

  /** Redraws when the next routines changed; returns true if it did. */
  refresh(state: OfficeState): boolean {
    const routines = upcomingRoutines(state.bots, LINES);
    const lines = routines.map((routine) => `${truncate(routine.name, NAME_MAX)} - ${formatOfficeClock(routine.at)}`);
    if (lines.length === 0) lines.push('None scheduled');
    const signature = lines.join('\n');
    if (signature === this.signature) return false;
    this.signature = signature;
    this.lines = lines;
    this.draw();
    return true;
  }

  dispose(): void {
    this.texture.dispose();
    this.face.dispose();
    this.frame.dispose();
    this.geometry.dispose();
    this.facePlane.dispose();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#20252c';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${Math.round(height * 0.15)}px ${FONT}`;
    ctx.fillText('Next routines', width * 0.06, height * 0.07);
    ctx.fillStyle = '#7a8594';
    ctx.fillRect(width * 0.06, height * 0.27, width * 0.88, 3);
    ctx.fillStyle = '#e9edf3';
    ctx.font = `600 ${Math.round(height * 0.12)}px ${FONT}`;
    this.lines.forEach((line, index) => {
      ctx.fillText(line, width * 0.06, height * (0.34 + index * 0.21), width * 0.88);
    });
    this.texture.needsUpdate = true;
  }
}
