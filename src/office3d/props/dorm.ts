import { type Part, PartBuilder } from './kit';

/** Bunk bed 1.0 x 2.0 m: head at -z, ladder at the foot (+z) end on the +x side. */
export function bunkParts(): Part[] {
  const b = new PartBuilder();
  const hx = 0.5;
  const hz = 1.0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.round('bedWood', [0.07, 1.78, 0.07], 0.015, [sx * (hx - 0.035), 0, sz * (hz - 0.035)]);
  }
  for (const [level, y] of [['lower', 0.22], ['upper', 1.14]] as const) {
    for (const sx of [-1, 1]) b.box('bedWood', [0.04, 0.12, 2.0 - 0.14], [sx * (hx - 0.04), y, 0]);
    b.box('bedWood', [1.0 - 0.14, 0.12, 0.04], [0, y, -hz + 0.035]);
    b.box('bedWood', [1.0 - 0.14, 0.12, 0.04], [0, y, hz - 0.035]);
    b.round('mattress', [0.92, 0.14, 1.9], 0.04, [0, y + 0.1, 0]);
    // Headboard panel and a low footboard.
    b.round('bedWood', [0.96, level === 'lower' ? 0.5 : 0.52, 0.035], 0.01, [0, y - 0.02, -hz + 0.02]);
    b.round('bedWood', [0.96, 0.2, 0.03], 0.01, [0, y + 0.02, hz - 0.015]);
  }
  // Folded throws at the foot.
  b.round('cushionLight', [0.8, 0.07, 0.4], 0.03, [0, 0.47, 0.62]);
  b.round('cushionA', [0.8, 0.07, 0.4], 0.03, [0, 1.39, 0.62]);
  // Upper guard rail along the open side.
  b.box('bedWood', [0.03, 0.3, 1.2], [-hx + 0.05, 1.4, -0.3]);
  b.box('bedWood', [0.03, 0.3, 0.5], [hx - 0.05, 1.4, -0.7]);
  // Ladder at the foot, on the right.
  for (const x of [0.2, 0.46]) b.box('bedWood', [0.035, 1.35, 0.035], [x, 0.0, hz + 0.02]);
  for (let i = 0; i < 4; i++) b.box('bedWood', [0.3, 0.03, 0.03], [0.33, 0.3 + i * 0.3, hz + 0.02]);
  return b.done();
}

/** Bedside table with a small lamp, front toward +z. */
export function nightstandParts(): Part[] {
  const b = new PartBuilder();
  b.round('woodLight', [0.4, 0.48, 0.4], 0.015, [0, 0.02, 0]);
  b.box('woodDark', [0.4, 0.04, 0.4], [0, 0, 0]);
  b.box('cabinetDoor', [0.32, 0.17, 0.012], [0, 0.07, 0.202]);
  b.box('cabinetDoor', [0.32, 0.17, 0.012], [0, 0.27, 0.202]);
  b.cyl('steel', 0.014, 0.014, 0.02, [0, 0.2, 0.216], 6, { rx: Math.PI / 2 });
  b.cyl('steel', 0.014, 0.014, 0.02, [0, 0.4, 0.216], 6, { rx: Math.PI / 2 });
  b.cyl('darkGrey', 0.05, 0.06, 0.03, [0, 0.5, -0.02], 10);
  b.cyl('darkGrey', 0.012, 0.012, 0.14, [0, 0.52, -0.02], 6);
  b.cyl('lamp', 0.07, 0.11, 0.15, [0, 0.64, -0.02], 12);
  return b.done();
}

/** Chest of drawers, 1.6 x 0.5, front toward +z. */
export function dresserParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.round('woodLight', [width, 0.84, depth], 0.02, [0, 0.04, 0]);
  b.box('woodDark', [width - 0.1, 0.04, depth - 0.1], [0, 0, 0]);
  b.round('woodTop', [width + 0.04, 0.04, depth + 0.04], 0.012, [0, 0.88, 0]);
  const cols = 3;
  const w = (width - 0.16) / cols;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 3; r++) {
      const x = -width / 2 + 0.08 + w * (c + 0.5);
      b.box('cabinetDoor', [w - 0.04, 0.2, 0.012], [x, 0.1 + r * 0.25, depth / 2 + 0.003]);
      b.cyl('steel', 0.015, 0.015, 0.02, [x, 0.17 + r * 0.25, depth / 2 + 0.016], 6, { rx: Math.PI / 2 });
    }
  }
  b.cyl('potWhite', 0.05, 0.04, 0.1, [-width / 2 + 0.25, 0.92, 0], 10);
  b.sphere('leaf', 0.07, [-width / 2 + 0.25, 1.06, 0], [1, 1.1, 1], 8);
  b.box('artBlue', [0.2, 0.12, 0.02], [0.3, 0.92, 0], { ry: -0.2 });
  return b.done();
}
