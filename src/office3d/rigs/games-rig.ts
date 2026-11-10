import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOOSBALL, GAMES, POOL } from '../layout';
import type { Rect, Vec2 } from '../layout.types';
import type { Materials } from '../materials';

// ---- Pool ---------------------------------------------------------------------------------------

export const POOL_BALL_COUNT = 16;
const BALL_RADIUS = 0.04;
const RAIL = 0.13;
/** Cue ball first, then the 8 ball at index 8, the rest in colour pairs. */
const BALL_COLORS: readonly number[] = [
  0xfaf6ee, 0xe3b34f, 0x4f7fd0, 0xd9544a, 0x8a5fa0, 0xe88a3c, 0x4fa066, 0x9a3b3b, 0x20232b,
  0xf0cf6a, 0x7aa0e0, 0xe67a70, 0xb090c4, 0xf0a868, 0x7cc08c, 0xc07070,
];

/** The 16 balls as one InstancedMesh. Positions are world plan coordinates on the cloth. */
export class PoolBalls {
  readonly mesh: InstancedMesh;
  /** The playable cloth in world coordinates (ball centres stay inside it). */
  readonly bounds: Rect;
  private readonly positions: Vec2[] = [];
  private readonly shown: boolean[] = [];
  private readonly scratch = new Matrix4();

  constructor(geometry: SphereGeometry, material: MeshStandardMaterial) {
    this.mesh = new InstancedMesh(geometry, material, POOL_BALL_COUNT);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.bounds = {
      x0: POOL.x - POOL.width / 2 + RAIL + BALL_RADIUS,
      x1: POOL.x + POOL.width / 2 - RAIL - BALL_RADIUS,
      z0: POOL.z - POOL.depth / 2 + RAIL + BALL_RADIUS,
      z1: POOL.z + POOL.depth / 2 - RAIL - BALL_RADIUS,
    };
    const color = new Color();
    for (let i = 0; i < POOL_BALL_COUNT; i++) {
      this.mesh.setColorAt(i, color.setHex(BALL_COLORS[i] ?? 0xffffff));
      this.positions.push({ x: POOL.x, z: POOL.z });
      this.shown.push(true);
    }
    this.rack();
  }

  get count(): number {
    return POOL_BALL_COUNT;
  }

  position(index: number): Vec2 | null {
    return this.positions[index] ?? null;
  }

  /** Moves a ball on the cloth (world x, z). Indices outside 0..15 are ignored. */
  setBall(index: number, x: number, z: number): void {
    if (index < 0 || index >= POOL_BALL_COUNT) return;
    this.positions[index] = { x, z };
    this.write(index);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Shows or hides a ball, e.g. after it drops into a pocket. */
  setVisible(index: number, visible: boolean): void {
    if (index < 0 || index >= POOL_BALL_COUNT) return;
    this.shown[index] = visible;
    this.write(index);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Triangle at the foot of the table, cue ball at the head spot. */
  rack(): void {
    const foot = POOL.x + POOL.width * 0.25;
    const gap = BALL_RADIUS * 2.04;
    let ball = 1;
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k <= row; k++) {
        const x = foot + row * gap * 0.87;
        const z = POOL.z + (k - row / 2) * gap;
        this.positions[ball] = { x, z };
        ball += 1;
      }
    }
    this.positions[0] = { x: POOL.x - POOL.width * 0.25, z: POOL.z };
    for (let i = 0; i < POOL_BALL_COUNT; i++) {
      this.shown[i] = true;
      this.write(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private write(index: number): void {
    const p = this.positions[index];
    if (p === undefined) return;
    const s = this.shown[index] === true ? 1 : 0;
    this.scratch.makeScale(s, s, s).setPosition(p.x, POOL.surfaceY + BALL_RADIUS * s, p.z);
    this.mesh.setMatrixAt(index, this.scratch);
  }
}

// ---- Table football -----------------------------------------------------------------------------

/** Men per rod, goalie to goalie: the usual 1-2-3-5-5-3-2-1 order, alternating teams as on a real table. */
const ROD_MEN: readonly number[] = [1, 2, 3, 5, 5, 3, 2, 1];
const ROD_TEAM: readonly (0 | 1)[] = [0, 0, 1, 0, 1, 0, 1, 1];
const TEAM_COLORS: readonly [number, number] = [0xd9544a, 0x4f7fd0];
const ROD_PITCH = 0.17;
const ROD_HEIGHT = 1.03;
const FIELD_HALF_WIDTH = (FOOSBALL.depth - 0.14) / 2;
const HANDLE_REACH = 0.2;
const MAX_SLIDE = 0.12;

/** One rod of the table: slide it along its length (metres) and twist it (radians) to move the men and the handle. */
export class FoosRod {
  private slide = 0;
  private twist = 0;

  constructor(
    readonly index: number,
    readonly team: 0 | 1,
    /** World x of the rod across the table. */
    readonly x: number,
    /** Offsets of the men along the rod, in metres from its centre. */
    readonly men: readonly number[],
    private readonly onChange: () => void,
  ) {}

  get slideOffset(): number {
    return this.slide;
  }

  get twistAngle(): number {
    return this.twist;
  }

  /** Slides the rod; clamped so the men stay inside the field. */
  setSlide(offset: number): void {
    const next = Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, offset));
    if (next === this.slide) return;
    this.slide = next;
    this.onChange();
  }

  setTwist(angle: number): void {
    if (angle === this.twist) return;
    this.twist = angle;
    this.onChange();
  }
}

/** The 8 rods with men and handles, and the ball. */
export class FoosballRig {
  readonly rods: readonly FoosRod[];
  readonly ball: Mesh;
  readonly rodMesh: InstancedMesh;
  readonly gripMesh: InstancedMesh;
  readonly menMesh: InstancedMesh;
  private dirty = true;
  private readonly scratch = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly axisZ = new Vector3(0, 0, 1);
  private readonly pos = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  constructor(materials: Materials, ballGeometry: SphereGeometry) {
    const rodGeo = new CylinderGeometry(0.008, 0.008, FOOSBALL.depth + HANDLE_REACH * 2, 6).rotateX(Math.PI / 2);
    const gripGeo = new CylinderGeometry(0.02, 0.02, 0.12, 8).rotateX(Math.PI / 2);
    const manGeo = mergeGeometries([
      new CylinderGeometry(0.018, 0.02, 0.1, 6).translate(0, -0.03, 0).toNonIndexed(),
      new SphereGeometry(0.024, 8, 6).translate(0, 0.036, 0).toNonIndexed(),
      new BoxGeometry(0.05, 0.05, 0.04).translate(0.012, -0.105, 0).toNonIndexed(),
    ], false);
    this.geometries = [rodGeo, gripGeo, manGeo];
    const rods: FoosRod[] = [];
    let men = 0;
    ROD_MEN.forEach((count, index) => {
      const offsets = Array.from({ length: count }, (_, i) => ((i + 0.5) / count - 0.5) * (FIELD_HALF_WIDTH * 2 - 0.1));
      men += count;
      rods.push(new FoosRod(index, ROD_TEAM[index] ?? 0, FOOSBALL.x + (index - 3.5) * ROD_PITCH, offsets, () => {
        this.dirty = true;
      }));
    });
    this.rods = rods;
    this.rodMesh = new InstancedMesh(rodGeo, materials.get('steel'), rods.length);
    this.gripMesh = new InstancedMesh(gripGeo, materials.get('black'), rods.length);
    this.menMesh = new InstancedMesh(manGeo, materials.get('tint'), men);
    const color = new Color();
    let man = 0;
    for (const rod of rods) {
      for (let i = 0; i < rod.men.length; i++) this.menMesh.setColorAt(man++, color.setHex(TEAM_COLORS[rod.team]));
    }
    for (const mesh of [this.rodMesh, this.gripMesh, this.menMesh]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.frustumCulled = false;
    }
    this.ball = new Mesh(ballGeometry, materials.get('white'));
    this.ball.position.set(FOOSBALL.x, FOOSBALL.surfaceY + 0.02, FOOSBALL.z);
    this.ball.scale.setScalar(0.55);
    this.write();
  }

  private readonly geometries: { dispose(): void }[];

  /** Moves the ball on the field (world x, z). */
  setBall(x: number, z: number): void {
    this.ball.position.set(x, FOOSBALL.surfaceY + 0.02, z);
  }

  /** Rewrites the instance matrices if any rod moved; returns true when it did. */
  flush(): boolean {
    if (!this.dirty) return false;
    this.write();
    return true;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.rodMesh.dispose();
    this.gripMesh.dispose();
    this.menMesh.dispose();
  }

  private write(): void {
    this.dirty = false;
    let man = 0;
    for (const rod of this.rods) {
      const z = FOOSBALL.z + rod.slideOffset;
      this.scratch.makeTranslation(rod.x, ROD_HEIGHT, z);
      this.rodMesh.setMatrixAt(rod.index, this.scratch);
      // The grip sits outside the table on the side of the team that plays it.
      const side = rod.team === 0 ? 1 : -1;
      this.pos.set(rod.x, ROD_HEIGHT, z + side * (FOOSBALL.depth / 2 + HANDLE_REACH - 0.06));
      this.gripMesh.setMatrixAt(rod.index, this.scratch.compose(this.pos, this.quat.identity(), this.one));
      this.quat.setFromAxisAngle(this.axisZ, rod.twistAngle);
      for (const offset of rod.men) {
        this.pos.set(rod.x, ROD_HEIGHT, z + offset);
        this.menMesh.setMatrixAt(man++, this.scratch.compose(this.pos, this.quat, this.one));
      }
    }
    for (const mesh of [this.rodMesh, this.gripMesh, this.menMesh]) mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- TV -----------------------------------------------------------------------------------------

export type ScreenMode = 'off' | 'menu' | 'game';

const SCREEN_SIZE = { width: 1.08, height: 0.61 } as const;
const SCREEN_PX = { width: 192, height: 108 } as const;
const GAME_HZ = 8;
const MODE_COLORS: Readonly<Record<ScreenMode, string>> = { off: '#10131c', menu: '#25407a', game: '#1d6a52' };

/** The lit TV panel: an unlit canvas texture, so it glows by day and night. */
export class ConsoleScreen {
  readonly mesh: Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry = new PlaneGeometry(SCREEN_SIZE.width, SCREEN_SIZE.height);
  private mode: ScreenMode = 'menu';
  private tint = 0x4f7fd0;
  private clock = 0;
  private lastStep = -1;

  constructor() {
    this.canvas.width = SCREEN_PX.width;
    this.canvas.height = SCREEN_PX.height;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.position.set(GAMES.console.screen.x, GAMES.console.screen.y, GAMES.console.screen.z);
    this.mesh.rotation.y = GAMES.console.screenYaw;
    this.draw(0);
  }

  get currentMode(): ScreenMode {
    return this.mode;
  }

  /** Switches what the screen shows: dark, a menu, or an animated game. */
  setMode(mode: ScreenMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.draw(this.clock);
  }

  /** Accent colour of the menu tiles and the game. */
  setTint(color: number): void {
    this.tint = color;
    this.draw(this.clock);
  }

  /** Steps the game animation; returns true when the picture changed. */
  update(deltaSeconds: number, reduced: boolean): boolean {
    if (this.mode !== 'game' || reduced) return false;
    this.clock += deltaSeconds;
    const step = Math.floor(this.clock * GAME_HZ);
    if (step === this.lastStep) return false;
    this.lastStep = step;
    this.draw(this.clock);
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private draw(time: number): void {
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;
    const { width, height } = this.canvas;
    const accent = `#${this.tint.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = MODE_COLORS[this.mode];
    ctx.fillRect(0, 0, width, height);
    if (this.mode === 'menu') {
      ctx.fillStyle = accent;
      for (let i = 0; i < 4; i++) ctx.fillRect(14 + i * 44, 40, 38, 38);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(14, 16, 80, 8);
    } else if (this.mode === 'game') {
      const t = time * 2;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(width / 2 - 1, 0, 2, height);
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(12, 18 + (Math.sin(t) * 0.5 + 0.5) * (height - 56), 6, 30);
      ctx.fillRect(width - 18, 18 + (Math.sin(t * 1.3 + 1) * 0.5 + 0.5) * (height - 56), 6, 30);
      ctx.fillStyle = accent;
      ctx.fillRect(width / 2 + Math.sin(t * 0.8) * (width / 2 - 36) - 4, height / 2 + Math.sin(t * 1.9) * (height / 2 - 14) - 4, 8, 8);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, width, 22);
    }
    this.texture.needsUpdate = true;
  }
}

// ---- Rig ----------------------------------------------------------------------------------------

/** Everything in the games room that moves: pool balls, table-football rods and ball, the TV screen. */
export class GamesRig {
  readonly group = new Group();
  readonly pool: PoolBalls;
  readonly foosball: FoosballRig;
  readonly screen: ConsoleScreen;
  private readonly ballGeometry = new SphereGeometry(BALL_RADIUS, 14, 10);
  private readonly ballMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  private reduced = false;

  constructor(materials: Materials) {
    this.pool = new PoolBalls(this.ballGeometry, this.ballMaterial);
    this.foosball = new FoosballRig(materials, this.ballGeometry);
    this.screen = new ConsoleScreen();
    this.group.add(this.pool.mesh, this.foosball.rodMesh, this.foosball.gripMesh, this.foosball.menMesh, this.foosball.ball, this.screen.mesh);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }

  /** Advances the animated parts; returns true when the picture changed. */
  update(deltaSeconds: number): boolean {
    const rods = this.foosball.flush();
    return this.screen.update(deltaSeconds, this.reduced) || rods;
  }

  dispose(): void {
    this.ballGeometry.dispose();
    this.ballMaterial.dispose();
    this.pool.mesh.dispose();
    this.foosball.dispose();
    this.screen.dispose();
  }
}
