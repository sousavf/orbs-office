import { Color, Mesh, Scene } from 'three';
import { prefersReducedMotion } from '../reduced-motion';
import { ContactShadows } from './contact-shadows';
import { type Daylight, smoothstep } from './daylight';
import { Exterior } from './exterior';
import { LightPools } from './light-pools';
import type { LightLevels } from './lighting-model';
import { CONTACT_OPACITY, SCENE_EXPOSURE } from './palette';
import { characterLight } from './scene-light';
import { SunPatches } from './sun-patches';
import { Materials } from './materials';
import type { DeskScreens } from './screens';
import { WorldFloor } from './world-floor';
import { type FurnitureBuild, buildFurniture } from './world-furniture';
import { WorldLights } from './world-lights';
import { WorldRigs } from './rigs';
import { WorldWalls } from './world-walls';

const DECOR_VISIBLE_DOT = 0.3;
const PATCH_WARM = new Color(0xffc98a);
/** How strongly the sun patches add to the floor at full sun. */
const PATCH_STRENGTH = 0.3;

/**
 * The static office scene: floors, walls, props and lighting. The palette is the daytime one; night is the
 * lights going down and the lamps coming up (see `applyLighting`), not a second palette.
 */
export class World {
  readonly scene = new Scene();
  readonly screens: DeskScreens;
  /** Things that change after the build: sleepers, lunch trays, island signs, games, the TV. */
  readonly rigs: WorldRigs;
  private readonly materials = new Materials();
  private readonly floor: WorldFloor;
  private readonly walls: WorldWalls;
  private readonly lights: WorldLights;
  private readonly furniture: FurnitureBuild;
  private readonly contact: ContactShadows;
  private readonly pools = new LightPools();
  private readonly patches = new SunPatches();
  readonly exterior = new Exterior();
  private sceneExposure: number = SCENE_EXPOSURE;
  private readonly patchColor = new Color();

  constructor() {
    this.floor = new WorldFloor();
    this.walls = new WorldWalls(this.materials);
    this.lights = new WorldLights();
    this.furniture = buildFurniture(this.materials);
    this.contact = new ContactShadows(this.furniture.shadowRects, CONTACT_OPACITY);
    this.screens = this.furniture.screens;
    this.rigs = new WorldRigs(this.materials);
    this.rigs.setReducedMotion(prefersReducedMotion());
    this.scene.add(
      this.exterior.group,
      this.floor.group,
      this.contact.mesh,
      this.walls.group,
      this.furniture.group,
      this.lights.group,
      ...this.rigs.groups,
      ...this.pools.meshes,
      this.patches.mesh,
    );
  }

  /**
   * Aims the cutaway at the camera. (cx, cz) points from the office toward the camera;
   * `target` is the rotation the camera is heading for, `shown` the current (possibly mid-turn) one.
   */
  setCamera(target: { x: number; z: number }, shown: { x: number; z: number }): void {
    this.walls.setCamera(target.x, target.z);
    this.lights.setHeading(shown.x, shown.z);
    for (const batch of this.furniture.decor) {
      batch.group.visible = batch.nx * shown.x + batch.nz * shown.z > DECOR_VISIBLE_DOT;
    }
  }

  snapCutaway(): void {
    this.walls.snap();
  }

  /** Advances time-based changes; returns true while the scene is still changing. */
  update(deltaSeconds: number): boolean {
    return this.walls.update(deltaSeconds);
  }

  /** Advances the rigs (breathing, TV, foosball rods); returns true when something moved. */
  updateRigs(deltaSeconds: number): boolean {
    return this.rigs.update(deltaSeconds);
  }

  updateExterior(nowMs: number): boolean {
    return this.exterior.update(nowMs, prefersReducedMotion());
  }

  setReducedMotion(reduced: boolean): void {
    this.rigs.setReducedMotion(reduced);
  }

  get exposure(): number {
    return this.sceneExposure;
  }

  /** Real lights currently lit (hemisphere, sun, fill and lamps). */
  get activeLights(): number {
    return this.lights.activeLights;
  }

  /** Lit sun patches on the floor right now. */
  get litWindows(): number {
    return this.patches.litWindows;
  }

  /**
   * Lights the scene for a daylight sample: sun, sky and lamps, window sky, sun patches and light pools.
   * Returns true when the sun moved enough that the shadow map must be redrawn.
   */
  applyLighting(levels: LightLevels, daylight: Daylight): boolean {
    const shadow = this.lights.apply(levels, daylight.sunDir);
    this.sceneExposure = levels.exposure;
    this.materials.setSky(daylight.skyTop, daylight.skyBottom, daylight.cityLights);
    this.materials.setLampLevel(daylight.lampFactor);
    this.pools.setGroups(levels.groups);
    this.contact.setOpacity(levels.contactOpacity);
    characterLight.value.set(levels.character[0], levels.character[1], levels.character[2]);
    const strength = PATCH_STRENGTH * daylight.sunStrength * smoothstep(0, 8, daylight.elevation + 3);
    this.patchColor.setHex(levels.sunColor).lerp(PATCH_WARM, 0.35).multiplyScalar(strength);
    this.patches.update(daylight.sunDir, this.patchColor);
    this.exterior.setLighting(levels, daylight);
    return shadow;
  }

  /** Lights each desk's lamp and the cool monitor glow on its top (0 to 1 each). */
  setDeskLights(lamps: readonly number[], monitors: readonly number[]): boolean {
    this.pools.setDesks(lamps, monitors);
    return this.screens.setLamps(lamps);
  }

  dispose(): void {
    this.scene.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.contact.dispose();
    this.pools.dispose();
    this.patches.dispose();
    this.exterior.dispose();
    this.floor.dispose();
    this.walls.dispose();
    this.rigs.dispose();
    this.furniture.dispose();
    this.materials.dispose();
  }
}
