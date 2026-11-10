import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { CONTACT_OPACITY } from './palette';

const LIFT = 0.04;
const SIZE_METRES = 0.62;
const START_CAPACITY = 64;

function blobTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.7)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Soft ground blobs under every character, drawn as one instanced mesh. */
export class BlobShadows {
  mesh: InstancedMesh;
  private readonly texture = blobTexture();
  private readonly geometry = new PlaneGeometry(SIZE_METRES, SIZE_METRES).rotateX(-Math.PI / 2);
  private readonly material: MeshBasicMaterial;
  private capacity = START_CAPACITY;

  constructor() {
    this.material = new MeshBasicMaterial({
      map: this.texture,
      color: 0x20150f,
      transparent: true,
      opacity: CONTACT_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = this.build(this.capacity);
  }

  /** Number of blobs drawn; grows the instance buffer when needed (existing matrices are kept). */
  setCount(count: number): void {
    if (count > this.capacity) {
      const old = this.mesh;
      this.capacity = Math.max(count, this.capacity * 2);
      this.mesh = this.build(this.capacity);
      this.mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      this.mesh.parent?.add(this.mesh);
      old.removeFromParent();
      old.dispose();
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Writes a translation-and-uniform-scale matrix without allocating. */
  place(index: number, x: number, z: number, scale: number): void {
    const m = this.mesh.instanceMatrix.array;
    const o = index * 16;
    m[o] = scale;
    m[o + 1] = 0;
    m[o + 2] = 0;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 1;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = 0;
    m[o + 9] = 0;
    m[o + 10] = scale;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = LIFT;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private build(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.count = 0;
    return mesh;
  }
}
