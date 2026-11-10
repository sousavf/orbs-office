import { AdditiveBlending, CanvasTexture, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function radialTexture(center: string, edge: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context !== null) {
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, center);
    gradient.addColorStop(1, edge);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
}

function signs(): { mesh: Mesh; texture: CanvasTexture; material: MeshBasicMaterial } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.fillStyle = '#604a43';
    context.fillRect(0, 0, 512, 192);
    context.fillStyle = '#ffe6bc';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = 'bold 29px sans-serif';
    ['BREAD & BEAN', 'CORNER SHOP', 'SUNDIAL BOOKS'].forEach((name, index) => context.fillText(name, 256, 32 + index * 64));
  }
  const texture = new CanvasTexture(canvas);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
  const parts = [4, 24, 44].map((x, index) => {
    const geometry = new PlaneGeometry(6.4, 0.7).rotateY(Math.PI).translate(x, 3.75, 47.78);
    const uv = geometry.getAttribute('uv');
    for (let vertex = 0; vertex < uv.count; vertex++) uv.setY(vertex, (uv.getY(vertex) + 2 - index) / 3);
    return geometry;
  });
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (geometry === null) throw new Error('Could not merge exterior signs');
  return { mesh: new Mesh(geometry, material), texture, material };
}

/** Two tiny canvas decals provide night pools and daytime contact shadows. */
export class ExteriorEffects {
  readonly group = new Group();
  private readonly poolTexture = radialTexture('rgba(255,168,72,0.9)', 'rgba(255,168,72,0)');
  private readonly shadowTexture = radialTexture('rgba(22,30,31,0.46)', 'rgba(22,30,31,0)');
  private readonly poolMaterial = new MeshBasicMaterial({ map: this.poolTexture, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  private readonly shadowMaterial = new MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false, opacity: 0.6 });
  private readonly sign = signs();
  private readonly pools: InstancedMesh;
  private readonly shadows: InstancedMesh;

  constructor(lamps: readonly (readonly [number, number])[], spots: readonly (readonly [number, number, number, number])[]) {
    this.pools = new InstancedMesh(new PlaneGeometry(6, 6).rotateX(-Math.PI / 2), this.poolMaterial, lamps.length);
    this.shadows = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMaterial, spots.length);
    const matrix = new Matrix4();
    lamps.forEach(([x, z], index) => this.pools.setMatrixAt(index, matrix.makeTranslation(x, -0.49, z)));
    spots.forEach(([x, z, width, depth], index) => this.shadows.setMatrixAt(index, matrix.makeScale(width, 1, depth).setPosition(x, -0.485, z)));
    this.pools.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.sign.mesh.position.y = -0.52;
    this.group.add(this.pools, this.shadows, this.sign.mesh);
  }

  setNight(level: number, dayFactor: number): void {
    this.poolMaterial.opacity = level * 0.4;
    this.pools.visible = level > 0.01;
    this.shadowMaterial.opacity = 0.48 + 0.25 * dayFactor;
    this.sign.material.opacity = 0.48 + 0.22 * level;
  }

  dispose(): void {
    this.pools.geometry.dispose();
    this.shadows.geometry.dispose();
    this.sign.mesh.geometry.dispose();
    this.pools.dispose();
    this.shadows.dispose();
    this.poolMaterial.dispose();
    this.shadowMaterial.dispose();
    this.poolTexture.dispose();
    this.shadowTexture.dispose();
    this.sign.material.dispose();
    this.sign.texture.dispose();
  }
}
