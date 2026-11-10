import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Matrix4, Vector3, type BufferGeometry, type InstancedMesh, type Mesh } from 'three';
import { CameraRig } from '../src/office3d/camera-rig';
import { ExteriorBatch } from '../src/office3d/exterior/batch';
import { buildBlocks } from '../src/office3d/exterior/blocks';
import { cityActivity } from '../src/office3d/exterior/density';
import { ExteriorEffects } from '../src/office3d/exterior/effects';
import { ExteriorPedestrians } from '../src/office3d/exterior/pedestrians';
import { CITY_CENTRE, distanceFromOffice, ISOMETRIC_PITCH, makeCityPlan, OFFICE_PLOT } from '../src/office3d/exterior/plan';
import { buildStreets } from '../src/office3d/exterior/streets';
import { ExteriorTraffic } from '../src/office3d/exterior/traffic';

const canvas = { width: 0, height: 0, getContext: () => ({
  fillStyle: '', textAlign: '', textBaseline: '', font: '',
  fillRect: () => {}, fillText: () => {},
  createRadialGradient: () => ({ addColorStop: () => {} }),
}) };
const fakeDocument = { hidden: false, createElement: () => ({ ...canvas }) };
Object.assign(globalThis, {
  window: { matchMedia: () => ({ matches: false }) },
  document: fakeDocument,
});

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

const near = new Vector3();
const heading = new Vector3();
const ground = new Vector3();
let largestExtent = 0;
let mostDistantVisible = 0;
for (const [width, height] of [[1920, 1080], [390, 844], [320, 1200], [3840, 2160], [320, 2400]] as const) {
  const rig = new CameraRig();
  rig.resize(width, height);
  const extent = rig.exteriorHalfExtent;
  const plan = makeCityPlan(extent);
  largestExtent = Math.max(largestExtent, extent);
  const x0 = plan.blocks.reduce((v, b) => Math.min(v, b.x - b.width / 2), Infinity);
  const x1 = plan.blocks.reduce((v, b) => Math.max(v, b.x + b.width / 2), -Infinity);
  const z0 = plan.blocks.reduce((v, b) => Math.min(v, b.z - b.depth / 2), Infinity);
  const z1 = plan.blocks.reduce((v, b) => Math.max(v, b.z + b.depth / 2), -Infinity);
  for (let turn = 0; turn < 4; turn++) {
    for (const x of [-6, 56]) for (const z of [-2.88, 26.88]) {
      rig.focusOn(x, z, 0);
      const camera = rig.camera;
      camera.updateMatrixWorld();
      camera.getWorldDirection(heading);
      for (const screenX of [-1, 1]) for (const screenY of [-1, 1]) {
        near.set(screenX, screenY, 0).unproject(camera);
        ground.copy(near).addScaledVector(heading, -near.y / heading.y);
        const edge = Math.max(Math.abs(ground.x - CITY_CENTRE.x), Math.abs(ground.z - CITY_CENTRE.z));
        mostDistantVisible = Math.max(mostDistantVisible, edge);
        assert(edge < extent - 10, `ground beyond fade start: ${width}x${height}, turn ${turn}`);
        assert(ground.x > x0 + 3 && ground.x < x1 - 3 && ground.z > z0 + 3 && ground.z < z1 - 3,
          `city edge visible: ${width}x${height}, turn ${turn}, pan ${x},${z}`);
      }
    }
    rig.rotate(1);
    rig.update(1);
  }
}
const compact = makeCityPlan(160);
const expanded = makeCityPlan(2_000);
for (const block of compact.blocks) {
  const match = expanded.blocks.find((candidate) => candidate.col === block.col && candidate.row === block.row);
  assert(match !== undefined && JSON.stringify(match) === JSON.stringify(block), 'a block changed across viewport extents');
}

const auditExtent = Number(process.argv[2] ?? largestExtent);
assert(Number.isFinite(auditExtent) && auditExtent >= 100, 'audit extent must be at least 100 metres');
const plan = makeCityPlan(auditExtent);
const solid = new ExteriorBatch();
const lit = new ExteriorBatch();
const street = buildStreets(plan, solid, lit);
const blocks = buildBlocks(plan, solid, lit);
const digest = createHash('sha256').update(JSON.stringify({ plan, solid: solid.primitives, lit: lit.primitives })).digest('hex');
if (process.argv.includes('--digest-only')) {
  console.log(digest);
  process.exit(0);
}
const repeated = spawnSync(process.execPath, [import.meta.path, String(auditExtent), '--digest-only'], { encoding: 'utf8', cwd: process.cwd() });
assert(repeated.status === 0 && repeated.stdout.trim() === digest, 'city geometry differs between processes');
let elevated = 0;
for (const primitive of [...solid.primitives, ...lit.primitives]) {
  if (primitive.y1 <= 0) continue;
  elevated++;
  const x = (primitive.x0 + primitive.x1) / 2;
  const z = (primitive.z0 + primitive.z1) / 2;
  const width = primitive.x1 - primitive.x0;
  const depth = primitive.z1 - primitive.z0;
  assert(primitive.x1 <= OFFICE_PLOT.x0 || primitive.x0 >= OFFICE_PLOT.x1 || primitive.z1 <= OFFICE_PLOT.z0 || primitive.z0 >= OFFICE_PLOT.z1,
    `exterior intersects office: ${JSON.stringify(primitive)}`);
  const clearance = distanceFromOffice(x, z, width, depth) * Math.tan(ISOMETRIC_PITCH) - primitive.y1;
  assert(clearance >= -0.02, `exterior could occlude office; clearance ${clearance.toFixed(2)}: ${JSON.stringify(primitive)}`);
}

function triangles(mesh: Mesh | InstancedMesh): number {
  const geometry = mesh.geometry as BufferGeometry;
  return ((geometry.index?.count ?? geometry.getAttribute('position').count) / 3) * ('isInstancedMesh' in mesh ? mesh.count : 1);
}

const effects = new ExteriorEffects(street.lamps, blocks.shadows);
fakeDocument.hidden = true;
const traffic = new ExteriorTraffic(plan);
const pedestrians = new ExteriorPedestrians(plan);
const initial = new Matrix4();
traffic.meshes[0]?.getMatrixAt(0, initial);
assert(initial.elements[12] !== 0 || initial.elements[14] !== 0, 'traffic was not positioned while hidden');
pedestrians.meshes[0]?.getMatrixAt(0, initial);
assert(initial.elements[12] !== 0 || initial.elements[14] !== 0, 'pedestrians were not positioned while hidden');
assert(!traffic.update(100, false) && !pedestrians.update(100, false), 'animation ran while hidden');
fakeDocument.hidden = false;
assert(!traffic.update(100, true) && !pedestrians.update(100, true), 'animation ran with reduced motion');
assert(!traffic.update(50, false) && !pedestrians.update(50, false), 'animation exceeded 10 fps');
assert(traffic.update(100, false) && pedestrians.update(100, false), 'animation did not advance at 10 fps');
for (const signX of [4, 24, 44]) {
  assert(distanceFromOffice(signX, 47.78, 6.4, 0.1) * Math.tan(ISOMETRIC_PITCH) > 3.58, 'shop sign could occlude office');
}
for (let time = 5_000; time <= 300_000; time += 5_000) {
  traffic.update(time, false);
  pedestrians.update(time, false);
  for (const [mesh, width, height] of [[traffic.meshes[0], 5.2, 0.5], [pedestrians.meshes[0], 0.6, 0.6]] as const) {
    if (mesh === undefined) continue;
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, initial);
      const x = initial.elements[12] ?? 0;
      const z = initial.elements[14] ?? 0;
      assert(distanceFromOffice(x, z, width, width) * Math.tan(ISOMETRIC_PITCH) > height,
        `moving exterior could occlude office at ${time} ms`);
    }
  }
}
const midday = cityActivity(12 * 60, 2);
const rush = cityActivity(8 * 60, 2);
const night = cityActivity(2 * 60, 2);
assert(midday.cars >= 0.85 && midday.walkers >= 0.95 && midday.buses, 'weekday daytime should be busy');
assert(rush.cars >= midday.cars, 'rush hour should peak above midday');
assert(night.cars >= 0.1 && night.cars <= 0.15 && night.walkers * 40 < 2 && !night.buses, 'night should be nearly empty');
assert(Math.abs(cityActivity(12 * 60, 6).cars / midday.cars - 0.6) < 0.05, 'weekend daytime should be about 60% of a weekday');
for (let minute = 0; minute < 24 * 60; minute++) {
  const now = cityActivity(minute, 3);
  const next = cityActivity(minute + 1, 3);
  assert(Math.abs(now.cars - next.cars) < 0.02 && Math.abs(now.walkers - next.walkers) < 0.02, `density jumps at minute ${minute}`);
}
traffic.setActivity(night, true);
pedestrians.setActivity(night, true);
traffic.update(10_000, true);
pedestrians.update(10_000, true);
assert((traffic.meshes[0]?.instanceMatrix.array.filter((_, index) => index % 16 === 5 && (traffic.meshes[0]?.instanceMatrix.array[index] ?? 0) > 0.01).length ?? 99) <= 4, 'night should leave only a few vehicles');
const extra = [...effects.group.children, ...traffic.meshes, ...pedestrians.meshes] as (Mesh | InstancedMesh)[];
const drawCalls = 5 + extra.length; // Ground, four static batches, then the instanced and sign meshes.
const triangleCount = solid.triangleCount + lit.triangleCount + 2 + extra.reduce((sum, mesh) => sum + triangles(mesh), 0);
assert(drawCalls <= 40, `draw calls over budget: ${drawCalls}`);
assert(triangleCount <= 250_000, `triangles over budget: ${triangleCount}`);
console.log(JSON.stringify({ coverage: { testedViewports: 5, rotations: 4, extremePans: 4, largestExtent: Math.ceil(largestExtent), mostDistantVisible: Math.ceil(mostDistantVisible) }, auditExtent, blocks: plan.blocks.length, elevatedPrimitives: elevated, drawCalls, triangles: triangleCount, digest }, null, 2));
effects.dispose();
traffic.dispose();
pedestrians.dispose();

