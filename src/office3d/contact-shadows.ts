import {
  type BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface ShadowRect {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

const SPREAD = 0.28;
const LIFT = 0.035;

/** Soft rounded-rectangle falloff, painted as concentric translucent rings. */
function falloffTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    const steps = 28;
    for (let i = 0; i < steps; i++) {
      const inset = (i / steps) * (size / 2);
      ctx.fillStyle = `rgba(0,0,0,${(1 / steps) * 1.15})`;
      ctx.beginPath();
      ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, Math.max(2, size * 0.3 - inset));
      ctx.fill();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** One mesh of soft blobs under furniture, so objects feel grounded beyond the shadow map's resolution. */
export class ContactShadows {
  readonly mesh: Mesh;
  private readonly texture = falloffTexture();
  private readonly material: MeshBasicMaterial;
  private readonly geometry: BufferGeometry;

  constructor(rects: readonly ShadowRect[], opacity: number) {
    const quads = rects.map((r) =>
      new PlaneGeometry(r.w + SPREAD * 2, r.d + SPREAD * 2).rotateX(-Math.PI / 2).translate(r.x, LIFT, r.z),
    );
    this.geometry = mergeGeometries(quads, false) ?? new PlaneGeometry(0.01, 0.01);
    for (const quad of quads) quad.dispose();
    this.material = new MeshBasicMaterial({
      map: this.texture,
      color: 0x20150f,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 1;
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
