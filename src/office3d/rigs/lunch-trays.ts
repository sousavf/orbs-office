import { type Group, type InstancedMesh, Matrix4 } from 'three';
import { LUNCH_SEATS } from '../layout';
import type { Materials } from '../materials';
import { PartBuilder, instanceProp, matrixAt } from '../props/kit';

/** Colours of the meal on a plate: tomato pasta, curry rice, salad, grilled meat. */
export const FOOD_COLORS: readonly number[] = [0xe0705a, 0xe3b34f, 0x6fa57a, 0xb8794a];
const TABLE_TOP = 0.77;
/** Distance from the seat to the tray centre, toward the table. */
const TRAY_REACH = 0.68;

/** One lunch tray, centred on its own origin; local +z points at the table's centre line. */
function trayParts(): ReturnType<PartBuilder['done']> {
  const b = new PartBuilder();
  b.round('tray', [0.4, 0.018, 0.3], 0.008, [0, 0, 0]);
  b.cyl('white', 0.105, 0.085, 0.016, [-0.04, 0.018, 0], 16);
  b.cyl('tint', 0.075, 0.07, 0.03, [-0.04, 0.034, 0], 10);
  b.cyl('white', 0.034, 0.028, 0.06, [0.14, 0.018, -0.07], 10);
  b.cyl('waterBlue', 0.03, 0.03, 0.012, [0.14, 0.072, -0.07], 10);
  b.box('steel', [0.012, 0.004, 0.13], [0.14, 0.018, 0.07]);
  b.box('steel', [0.012, 0.004, 0.13], [0.165, 0.018, 0.07]);
  b.box('paper', [0.07, 0.006, 0.05], [-0.15, 0.018, 0.1], { ry: 0.3 });
  return b.done();
}

/** A tray with a plate, a cup, cutlery and a napkin at every lunch seat; each is shown or hidden on its own. */
export class LunchTrays {
  readonly group: Group;
  private readonly meshes: readonly InstancedMesh[];
  private readonly ids = new Map<string, number>();
  private readonly shown = new Set<string>();
  private readonly placed: readonly Matrix4[];
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);

  constructor(materials: Materials) {
    this.placed = LUNCH_SEATS.map((seat, index) => {
      this.ids.set(seat.id, index);
      const x = seat.position.x + seat.facing.x * TRAY_REACH;
      const z = seat.position.z + seat.facing.z * TRAY_REACH;
      return matrixAt(x, TABLE_TOP, z, seat.yaw);
    });
    const prop = instanceProp(trayParts(), this.placed, materials, {
      tint: LUNCH_SEATS.map((_, index) => FOOD_COLORS[index % FOOD_COLORS.length] ?? 0xffffff),
    });
    this.group = prop.group;
    this.meshes = [...prop.meshes.values()];
    for (const mesh of prop.meshes.values()) {
      mesh.castShadow = false;
      mesh.frustumCulled = false;
    }
    LUNCH_SEATS.forEach((_, index) => this.write(index, false));
  }

  /** Shows or hides the tray at a lunch seat. Unknown seat ids are ignored. */
  setTray(seatId: string, visible: boolean): void {
    const index = this.ids.get(seatId);
    if (index === undefined) return;
    if (visible) this.shown.add(seatId);
    else this.shown.delete(seatId);
    this.write(index, visible);
  }

  isVisible(seatId: string): boolean {
    return this.shown.has(seatId);
  }

  clear(): void {
    for (const id of [...this.shown]) this.setTray(id, false);
  }

  private write(index: number, visible: boolean): void {
    const matrix = visible ? this.placed[index] : this.hidden;
    if (matrix === undefined) return;
    for (const mesh of this.meshes) {
      mesh.setMatrixAt(index, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
