import { CanvasTexture, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { DESK_SLOTS, FURNITURE, LUNCH_SEATS, MEETING_ROOMS, SEAT_FOOTPRINTS, WALL_DECOR } from './layout';
import type { Furniture, WallDecor } from './layout.types';
import type { MatKey, Materials } from './materials';
import { CHAIR_COLORS, MUG_COLORS } from './palette';
import { artParts, doorMatParts, posterParts, rugParts, windowParts } from './props/decor';
import { diningChairParts, lunchTableParts } from './props/dining';
import { bunkParts, dresserParts, nightstandParts } from './props/dorm';
import { cueRackParts, foosballBodyParts, gameShelfParts, poolTableParts, tvStandParts } from './props/games';
import { chairParts, deskParts, deskPlantParts, dividerParts, mugParts, stoolParts } from './props/desk';
import { type InstancedProp, type Part, StaticBatch, instanceProp, matrixAt, seeded } from './props/kit';
import {
  coffeeMachineParts, coffeeTableParts, counterParts, fridgeParts, floorLampParts, roundTableParts,
  sideTableParts, sinkCounterParts, sofaParts,
} from './props/kitchen';
import { parcelPileParts, shelfParts, sortingTableParts } from './props/mailroom';
import { meetingTableParts, whiteboardParts } from './props/meeting';
import { coolerParts, plantParts } from './props/plants';
import { receptionParts, stanchionParts } from './props/reception';
import { DeskScreens } from './screens';

/** Furniture drawn as instances elsewhere. */
const INSTANCED_KINDS: ReadonlySet<Furniture['kind']> = new Set(['desk', 'stool']);

function partsFor(item: Furniture, shelfIndex: number, gameShelfIndex: number): Part[] {
  const { width: w, depth: d, variant } = item;
  switch (item.kind) {
    case 'divider': return dividerParts(w);
    case 'meeting-table': return meetingTableParts(w, d);
    case 'whiteboard': return whiteboardParts();
    case 'counter': return counterParts(w, d);
    case 'sink-counter': return sinkCounterParts(w, d);
    case 'fridge': return fridgeParts();
    case 'coffee-machine': return coffeeMachineParts();
    case 'round-table': return roundTableParts(w);
    case 'sofa': return sofaParts(w, d);
    case 'coffee-table': return coffeeTableParts(w, d);
    case 'shelf': return shelfParts(shelfIndex);
    case 'sorting-table': return sortingTableParts(w, d);
    case 'parcels': return parcelPileParts();
    case 'reception': return receptionParts(w, d);
    case 'plant': return plantParts(variant);
    case 'cooler': return coolerParts();
    case 'rug': return rugParts(w, d, variant);
    case 'floor-lamp': return floorLampParts();
    case 'stanchion': return stanchionParts();
    case 'door-mat': return doorMatParts(w, d);
    case 'side-table': return sideTableParts();
    case 'bunk-bed': return bunkParts();
    case 'nightstand': return nightstandParts();
    case 'dresser': return dresserParts(w, d);
    case 'lunch-table': return lunchTableParts(w, d);
    case 'pool-table': return poolTableParts(w, d);
    case 'foosball-table': return foosballBodyParts(w, d);
    case 'tv-stand': return tvStandParts(w);
    case 'cue-rack': return cueRackParts(w);
    case 'game-shelf': return gameShelfParts(gameShelfIndex);
    case 'desk':
    case 'stool':
      return [];
  }
}

function decorParts(item: WallDecor): Part[] {
  if (item.kind === 'window') return windowParts(item.width, item.height, item.variant);
  if (item.kind === 'poster') return posterParts(item.width, item.height, item.variant);
  return artParts(item.width, item.height, item.variant);
}

/** Sign texture for the approvals counter. */
function signTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = '#f6efdc';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#4c7a56';
    ctx.font = '700 54px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 52);
    ctx.fillRect(16, 84, 480, 4);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The four directions a wall decor can face; each batch shows only when that wall is behind the interior. */
export interface DecorBatch {
  readonly nx: number;
  readonly nz: number;
  readonly group: Group;
}

export interface FurnitureBuild {
  readonly group: Group;
  readonly decor: readonly DecorBatch[];
  readonly screens: DeskScreens;
  /** Floor footprints (x, z, width, depth) that get a soft contact shadow. */
  readonly shadowRects: readonly { x: number; z: number; w: number; d: number }[];
  readonly dispose: () => void;
}

export function buildFurniture(materials: Materials): FurnitureBuild {
  const group = new Group();
  const disposables: { dispose: () => void }[] = [];
  const rand = seeded(2024);

  // Desks (instanced, with per-desk screens) and their small extras.
  const deskMatrices = DESK_SLOTS.map((s) => scaledMatrix(s.desk.x, s.desk.z, s.deskRotY, s.scale));
  const desks = instanceProp(deskParts(), deskMatrices, materials, { screen: DESK_SLOTS.map(() => 0xffffff), deskLamp: DESK_SLOTS.map(() => 0xffffff) });
  const withMug = DESK_SLOTS.filter((s) => (s.id * 7) % 3 !== 1);
  const mugs = instanceProp(mugParts(), withMug.map((s) => deskMatrices[s.id] ?? new Matrix4()), materials, {
    tint: withMug.map((s) => MUG_COLORS[s.id % MUG_COLORS.length] ?? 0xffffff),
  });
  const withPlant = DESK_SLOTS.filter((s) => s.id % 5 === 2);
  const deskPlants = instanceProp(deskPlantParts(), withPlant.map((s) => deskMatrices[s.id] ?? new Matrix4()), materials);

  // Chairs: desk chairs (slightly turned) then meeting seats, one instanced draw per material.
  const chairMatrices: Matrix4[] = [];
  const chairColors: number[] = [];
  DESK_SLOTS.forEach((s) => {
    chairMatrices.push(matrixAt(s.chair.x, 0, s.chair.z, s.facingYaw + (rand() - 0.5) * 0.7));
    chairColors.push(CHAIR_COLORS[Math.floor(rand() * CHAIR_COLORS.length)] ?? 0xffffff);
  });
  MEETING_ROOMS.forEach((room, roomIndex) => {
    for (const seat of room.seats) {
      chairMatrices.push(matrixAt(seat.pos.x, 0, seat.pos.z, seat.facingYaw));
      chairColors.push(roomIndex === 0 ? 0x4f9aa6 : 0x8e78b8);
    }
  });
  const chairs = instanceProp(chairParts(), chairMatrices, materials, { tint: chairColors });
  const diners = instanceProp(
    diningChairParts(),
    LUNCH_SEATS.map((seat) => matrixAt(seat.position.x, 0, seat.position.z, seat.yaw)),
    materials,
    { tint: LUNCH_SEATS.map((_, i) => CHAIR_COLORS[(i * 7 + Math.floor(i / 5)) % CHAIR_COLORS.length] ?? 0xffffff) },
  );

  const stools = FURNITURE.filter((f) => f.kind === 'stool');
  const stoolProp = instanceProp(stoolParts(), stools.map((f) => matrixAt(f.x, 0, f.z)), materials, {
    tint: stools.map((_, i) => CHAIR_COLORS[i % CHAIR_COLORS.length] ?? 0xffffff),
  });

  for (const prop of [desks, mugs, deskPlants, chairs, diners, stoolProp]) group.add(prop.group);

  // One-off furniture, merged into a handful of meshes.
  const batch = new StaticBatch();
  let shelfIndex = 0;
  let gameShelfIndex = 0;
  for (const item of FURNITURE) {
    if (INSTANCED_KINDS.has(item.kind)) continue;
    if (item.kind === 'shelf') shelfIndex++;
    if (item.kind === 'game-shelf') gameShelfIndex++;
    batch.add(partsFor(item, shelfIndex, gameShelfIndex), matrixAt(item.x, 0, item.z, item.rotY));
  }
  group.add(batch.build(materials));

  group.add(buildSign(disposables));
  const decor = buildDecor(materials);
  for (const d of decor) group.add(d.group);

  const shadowRects = FURNITURE.filter((f) => f.blocks || f.kind === 'stool' || f.kind === 'sofa').map((f) => {
    const turned = Math.abs(Math.sin(f.rotY)) > 0.5;
    return { x: f.x, z: f.z, w: turned ? f.depth : f.width, d: turned ? f.width : f.depth };
  });
  // Chairs of every kind, from the same list the nav grid blocks.
  for (const fp of SEAT_FOOTPRINTS) {
    const w = fp.rect.x1 - fp.rect.x0;
    const d = fp.rect.z1 - fp.rect.z0;
    if (w <= 0.7 && d <= 0.7) shadowRects.push({ x: fp.pos.x, z: fp.pos.z, w: 0.7, d: 0.7 });
  }

  return {
    group,
    decor,
    screens: screensFor(desks),
    shadowRects,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

function scaledMatrix(x: number, z: number, rotY: number, scale: number): Matrix4 {
  return matrixAt(x, 0, z, rotY).multiply(new Matrix4().makeScale(scale, 1, scale));
}

function screensFor(desks: InstancedProp): DeskScreens {
  const screenKey: MatKey = 'screen';
  const lampKey: MatKey = 'deskLamp';
  return new DeskScreens(desks.meshes.get(screenKey), DESK_SLOTS.length, desks.meshes.get(lampKey));
}

function buildSign(disposables: { dispose: () => void }[]): Mesh {
  const texture = signTexture('APPROVALS');
  const geometry = new PlaneGeometry(2.4, 0.45);
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.8 });
  disposables.push(texture, geometry, material);
  const mesh = new Mesh(geometry, material);
  const counter = FURNITURE.find((f) => f.kind === 'reception');
  mesh.position.set(counter?.x ?? 10, 0.62, (counter?.z ?? 13.5) + (counter?.depth ?? 0.8) / 2 + 0.018);
  mesh.receiveShadow = true;
  return mesh;
}

function buildDecor(materials: Materials): DecorBatch[] {
  const byNormal = new Map<string, { nx: number; nz: number; batch: StaticBatch }>();
  for (const item of WALL_DECOR) {
    const key = `${item.nx},${item.nz}`;
    const entry = byNormal.get(key) ?? { nx: item.nx, nz: item.nz, batch: new StaticBatch() };
    byNormal.set(key, entry);
    // Parts face +z locally; yaw turns +z onto the wall normal. Offset so the frame back sits on the wall face.
    const yaw = Math.atan2(item.nx, item.nz);
    const inset = 0.075 + 0.02;
    entry.batch.add(decorParts(item), matrixAt(item.x + item.nx * inset, item.y, item.z + item.nz * inset, yaw));
  }
  return [...byNormal.values()].map(({ nx, nz, batch }) => ({ nx, nz, group: batch.build(materials) }));
}
