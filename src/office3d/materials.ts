import {
  Color,
  DoubleSide,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
} from 'three';

/** Every flat colour a prop can use. */
const TABLE = {
  woodTop: 0xc58f5c,
  woodDark: 0x8d6240,
  woodLight: 0xe2bd8a,
  white: 0xf4efe6,
  paper: 0xfbf8f1,
  black: 0x2b2f38,
  darkGrey: 0x4b505c,
  steel: 0xb9c0c8,
  tint: 0xffffff,
  leaf: 0x5fa86a,
  leafLight: 0x8cc77c,
  leafDark: 0x3f8456,
  pot: 0xd9825f,
  potWhite: 0xf0ebe0,
  potTeal: 0x4f9aa6,
  soil: 0x5b4332,
  counterBody: 0x6fa57a,
  counterTop: 0xf6efdc,
  cabinetDoor: 0x82b98b,
  fridge: 0x9fd6c9,
  coffeeBody: 0xd9654f,
  sofa: 0x4f8f9a,
  cushionA: 0xe3b34f,
  cushionB: 0xe0705a,
  cushionLight: 0x73aab4,
  rugTeal: 0x4f8f9a,
  rugPlum: 0x8a5f8a,
  rugCream: 0xf1e3c8,
  rugCoral: 0xe8836b,
  rugKraft: 0xcfa56b,
  rugSage: 0x8db685,
  rugBorder: 0xf8ecd2,
  parcelKraft: 0xc99a62,
  parcelRed: 0xd9654f,
  parcelBlue: 0x4f9aa6,
  parcelYellow: 0xe3b34f,
  frame: 0x6b4a34,
  artRed: 0xe0705a,
  artBlue: 0x4f9aa6,
  artYellow: 0xe3b34f,
  artGreen: 0x6fa57a,
  artCream: 0xf6efdc,
  receptionBody: 0x7fae88,
  receptionTop: 0xf2e8d0,
  divider: 0x7aa7b0,
  board: 0xfbfaf6,
  waterBlue: 0x9fd8f0,
  rubber: 0x4d4f58,
  hazard: 0xe3b34f,
  poolCloth: 0x3f9a74,
  poolRail: 0x7a4a32,
  foosField: 0x5fae6a,
  mattress: 0xf3ead8,
  pillow: 0xfdf8ee,
  bedWood: 0xdcb48a,
  curtain: 0xe6a3b5,
  tray: 0x8aa0b8,
} as const satisfies Record<string, number>;

export type ToneKey = keyof typeof TABLE;
export type MatKey = ToneKey | 'screen' | 'lamp' | 'glass' | 'sky' | 'deskLamp';

export const MAT_KEYS: readonly MatKey[] = [...(Object.keys(TABLE) as ToneKey[]), 'screen', 'lamp', 'glass', 'sky', 'deskLamp'];

/** Parts that only receive shadows (flat decals and thin cloth) or neither. */
export const NO_CAST: ReadonlySet<MatKey> = new Set<MatKey>([
  'rugTeal', 'rugPlum', 'rugCream', 'rugCoral', 'rugKraft', 'rugSage', 'rugBorder', 'rubber', 'hazard',
  'glass', 'screen', 'lamp', 'sky', 'deskLamp',
]);

/** Lamp shades and bulbs: a pale unlit tone by day, a glowing warm one (above 1, so it blooms through the tone mapper) at night. */
const LAMP_OFF = new Color(0.62, 0.55, 0.44);
const LAMP_ON = new Color(2.6, 1.75, 0.95);

const SKY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A window pane: a vertical sky gradient with, at night, a skyline of distant lit windows. */
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uCity;
  varying vec2 vUv;
  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
    vec2 grid = vec2(16.0, 9.0);
    vec2 seed = floor(vWorld.xz * 2.0);
    vec2 cell = floor(vUv * grid);
    vec2 local = fract(vUv * grid) - 0.5;
    float h = hash(cell + seed * 7.3);
    float skyline = 0.18 + 0.2 * hash(vec2(cell.x, seed.x + seed.y));
    float below = step(vUv.y, skyline);
    float dotMask = smoothstep(0.34, 0.18, length(local * vec2(1.0, 1.4)));
    float lit = step(0.7, h) * below * dotMask * uCity;
    vec3 lamp = mix(vec3(1.8, 1.3, 0.7), vec3(1.2, 1.5, 1.9), step(0.85, hash(cell + 3.1)));
    // The buildings themselves: a darker band under the skyline.
    c = mix(c, c * 0.45, below * uCity * 0.75);
    c = mix(c, lamp, lit);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface SkyUniforms {
  uTop: { value: Color };
  uBottom: { value: Color };
  uCity: { value: number };
  [uniform: string]: { value: unknown };
}

function isToneKey(key: MatKey): key is ToneKey {
  return key in TABLE;
}

/** Shared materials for all props. */
export class Materials {
  private readonly byKey = new Map<MatKey, Material>();

  constructor() {
    for (const key of MAT_KEYS) this.byKey.set(key, this.create(key));
    this.paint();
    this.setLampLevel(0);
  }

  get(key: MatKey): Material {
    const material = this.byKey.get(key);
    if (material === undefined) throw new Error(`Unknown material ${key}`);
    return material;
  }

  private paint(): void {
    for (const [key, material] of this.byKey) {
      if (material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial) {
        if (isToneKey(key)) material.color.setHex(TABLE[key]);
        else if (key === 'screen') material.color.setHex(0xffffff);
      }
    }
  }

  /** Window sky colours (top, bottom) and how strongly the city lights show. */
  setSky(top: number, bottom: number, city: number): void {
    const material = this.byKey.get('sky');
    if (!(material instanceof ShaderMaterial)) return;
    const { uTop, uBottom, uCity } = material.uniforms as SkyUniforms;
    uTop.value.setHex(top);
    uBottom.value.setHex(bottom);
    uCity.value = city;
  }

  /** How brightly lamp shades and bulbs glow, 0 (off) to 1. */
  setLampLevel(level: number): void {
    const material = this.byKey.get('lamp');
    if (material instanceof MeshBasicMaterial) material.color.copy(LAMP_OFF).lerp(LAMP_ON, level);
  }

  dispose(): void {
    for (const material of this.byKey.values()) material.dispose();
    this.byKey.clear();
  }

  private create(key: MatKey): Material {
    if (key === 'screen' || key === 'lamp' || key === 'deskLamp') return new MeshBasicMaterial({ color: 0xffffff });
    if (key === 'sky') {
      const uniforms: SkyUniforms = {
        uTop: { value: new Color(0x5fa8e6) },
        uBottom: { value: new Color(0xc4e4f4) },
        uCity: { value: 0 },
      };
      return new ShaderMaterial({ uniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT });
    }
    if (key === 'glass') {
      return new MeshStandardMaterial({
        color: 0xcfe9f2,
        transparent: true,
        opacity: 0.22,
        roughness: 0.1,
        depthWrite: false,
        side: DoubleSide,
      });
    }
    const metal = key === 'steel';
    return new MeshStandardMaterial({
      roughness: metal ? 0.4 : 0.78,
      metalness: metal ? 0.25 : 0,
    });
  }
}
