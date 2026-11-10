import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BoxGeometry, type BufferGeometry, type CanvasTexture, Group, Mesh, MeshStandardMaterial } from 'three';
import { createFloorTexture } from './floor-textures';
import { ROOMS } from './layout';
import type { ZoneId } from './layout.types';
import { SLAB, zoneStyle } from './palette';

const FLOOR_THICKNESS = 0.12;
const SLAB_MARGIN = 0.35;
const SLAB_THICKNESS = 0.4;

interface ZoneFloor {
  readonly zone: ZoneId;
  readonly texture: CanvasTexture;
  readonly top: MeshStandardMaterial;
}

/** Floors per zone plus the dark base slab that gives the office its diorama edge. */
export class WorldFloor {
  readonly group = new Group();
  private readonly floors: ZoneFloor[] = [];
  private readonly slabMaterial = new MeshStandardMaterial({ roughness: 0.95 });
  private readonly edgeMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  private readonly geometries: BufferGeometry[] = [];

  constructor() {
    for (const room of ROOMS) {
      const width = room.rect.x1 - room.rect.x0;
      const depth = room.rect.z1 - room.rect.z0;
      const style = zoneStyle(room.id);
      const texture = createFloorTexture(room.id, style, width, depth);
      const top = new MeshStandardMaterial({ map: texture, roughness: room.id === 'corridor' || room.id === 'hall' ? 0.55 : 0.85 });
      const geometry = new BoxGeometry(width, FLOOR_THICKNESS, depth);
      this.geometries.push(geometry);
      const edge = this.edgeMaterial;
      const mesh = new Mesh(geometry, [edge, edge, top, edge, edge, edge]);
      mesh.position.set(room.rect.x0 + width / 2, -FLOOR_THICKNESS / 2, room.rect.z0 + depth / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.floors.push({ zone: room.id, texture, top });
    }
    // The building is an L, so the diorama base is one slab per room; overlaps share a top height.
    const slabs = ROOMS.map((room) => {
      const width = room.rect.x1 - room.rect.x0 + SLAB_MARGIN * 2;
      const depth = room.rect.z1 - room.rect.z0 + SLAB_MARGIN * 2;
      return new BoxGeometry(width, SLAB_THICKNESS, depth).translate(
        room.rect.x0 + (room.rect.x1 - room.rect.x0) / 2,
        -FLOOR_THICKNESS - SLAB_THICKNESS / 2 + 0.01,
        room.rect.z0 + (room.rect.z1 - room.rect.z0) / 2,
      );
    });
    const merged = mergeGeometries(slabs, false);
    for (const slab of slabs) slab.dispose();
    this.geometries.push(merged);
    const base = new Mesh(merged, this.slabMaterial);
    base.receiveShadow = true;
    this.group.add(base);
    this.slabMaterial.color.setHex(SLAB);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const floor of this.floors) {
      floor.texture.dispose();
      floor.top.dispose();
    }
    this.slabMaterial.dispose();
    this.edgeMaterial.dispose();
  }
}
