import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  PointLight,
  Vector3,
} from 'three';
import type { Vec3 } from './daylight';
import { LAMP_SPOTS, OFFICE, OFFICE_CORNERS } from './layout';
import type { LightGroup, LightLevels } from './lighting-model';
import { LAMP_COLOR } from './palette';

/** Camera-side fill: toward the camera, to its left, and high. */
const FILL_TOWARD = 20;
const FILL_LEFT = 10;
const FILL_HEIGHT = 31;
const SUN_DISTANCE = 42;
/** The shadow-casting sun never drops below this, so shadows stay a sensible length (the floor patches use the true angle). */
const MIN_SHADOW_ELEVATION = 14;
const SHADOW_MAP_SIZE = 3072;
const SHADOW_REFIT_DEGREES = 2;
const LAMP_RANGE = 10;
const LAMP_PEAK = 9;

/** Which light groups feed each real point light; it burns as bright as its brightest group. */
const LAMP_GROUPS: Readonly<Record<string, readonly LightGroup[]>> = {
  west: ['meeting-a', 'meeting-b', 'mailroom'],
  approvals: ['approvals', 'corridor'],
  kitchen: ['kitchen'],
  workspaceWest: ['workspace'],
  workspaceEast: ['workspace'],
  hall: ['hall'],
  dormitory: ['dormNight', 'dormitory'],
  games: ['games', 'poolTable'],
};

interface Lamp {
  readonly light: PointLight;
  readonly groups: readonly LightGroup[];
}

/** Hemisphere fill, the sun (with a shadow camera fitted to the office), a camera-side fill and eight warm lamps. */
export class WorldLights {
  readonly group = new Group();
  readonly hemisphere = new HemisphereLight();
  readonly sun = new DirectionalLight();
  private readonly fill = new DirectionalLight();
  private readonly lamps: Lamp[] = [];
  private heading = { x: NaN, z: NaN };
  private readonly shadowDir = new Vector3(NaN, NaN, NaN);

  constructor() {
    const center = new Vector3(OFFICE.width / 2, 0, OFFICE.depth / 2);
    this.sun.target.position.copy(center);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3.5;
    this.fill.target.position.copy(center);
    this.group.add(this.hemisphere, this.sun, this.sun.target, this.fill, this.fill.target);
    for (const [key, spot] of Object.entries(LAMP_SPOTS)) {
      const light = new PointLight(LAMP_COLOR, 0, LAMP_RANGE, 1.6);
      light.position.set(spot.x, spot.y, spot.z);
      this.lamps.push({ light, groups: LAMP_GROUPS[key] ?? [] });
      this.group.add(light);
    }
    this.setHeading(1, 1);
  }

  /** Keeps the fill on the side of the walls that faces the camera as the view rotates; (hx, hz) points toward the camera. */
  setHeading(hx: number, hz: number): void {
    const length = Math.hypot(hx, hz) || 1;
    const x = hx / length;
    const z = hz / length;
    if (Math.abs(x - this.heading.x) < 1e-4 && Math.abs(z - this.heading.z) < 1e-4) return;
    this.heading = { x, z };
    // Camera right is (z, -x), so "left" is (-z, x).
    this.fill.position.set(
      OFFICE.width / 2 + x * FILL_TOWARD - z * FILL_LEFT,
      FILL_HEIGHT,
      OFFICE.depth / 2 + z * FILL_TOWARD + x * FILL_LEFT,
    );
  }

  /** Real lights currently contributing (hemisphere, sun, fill, lamps), for diagnostics. */
  get activeLights(): number {
    const lamps = this.lamps.filter(({ light }) => light.intensity > 0.01).length;
    const directional = [this.sun, this.fill].filter((light) => light.intensity > 0.01).length;
    return 1 + directional + lamps;
  }

  /**
   * Applies a lighting state. Returns true when the sun moved far enough that the static shadow map
   * must be redrawn.
   */
  apply(levels: LightLevels, sunDir: Vec3): boolean {
    this.hemisphere.color.setHex(levels.hemiSky);
    this.hemisphere.groundColor.setHex(levels.hemiGround);
    this.hemisphere.intensity = levels.hemiIntensity;
    this.sun.color.setHex(levels.sunColor);
    this.sun.intensity = levels.sunIntensity;
    this.fill.intensity = levels.fillIntensity;
    for (const { light, groups } of this.lamps) {
      const level = Math.max(0, ...groups.map((group) => levels.groups[group]));
      light.intensity = LAMP_PEAK * level;
    }
    return this.aimSun(sunDir);
  }

  private aimSun(sunDir: Vec3): boolean {
    const horizontal = Math.hypot(sunDir.x, sunDir.z) || 1;
    const minY = Math.sin((MIN_SHADOW_ELEVATION * Math.PI) / 180);
    const y = Math.max(sunDir.y, minY);
    const scale = Math.sqrt(Math.max(0, 1 - y * y)) / horizontal;
    const dir = new Vector3(sunDir.x * scale, y, sunDir.z * scale).normalize();
    if (Number.isFinite(this.shadowDir.x)) {
      const angle = (Math.acos(Math.min(1, this.shadowDir.dot(dir))) * 180) / Math.PI;
      if (angle < SHADOW_REFIT_DEGREES) return false;
    }
    this.shadowDir.copy(dir);
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, SUN_DISTANCE);
    this.fitShadowCamera();
    return true;
  }

  /** Sizes the orthographic shadow frustum to the office box as seen from the sun. */
  private fitShadowCamera(): void {
    this.sun.updateMatrixWorld(true);
    this.sun.target.updateMatrixWorld(true);
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld(true);
    const toLight = new Matrix4().copy(cam.matrixWorld).invert();
    const box = new Box3();
    const corner = new Vector3();
    for (const [cx = 0, cz = 0] of OFFICE_CORNERS) {
      for (const y of [-0.3, OFFICE.wallHeight + 0.3]) {
        for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
          box.expandByPoint(corner.set(cx + dx, y, cz + dz).applyMatrix4(toLight));
        }
      }
    }
    cam.left = box.min.x;
    cam.right = box.max.x;
    cam.bottom = box.min.y;
    cam.top = box.max.y;
    cam.near = Math.max(0.1, -box.max.z - 1);
    cam.far = -box.min.z + 1;
    cam.updateProjectionMatrix();
  }
}
