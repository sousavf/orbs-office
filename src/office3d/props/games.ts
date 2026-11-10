import { type Part, PartBuilder, seeded } from './kit';

/** Pool table `width` x `depth` with legs, rails, six pockets and a hanging lamp. Cloth top at y 0.82. */
export function poolTableParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  const rail = 0.13;
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.round('poolRail', [0.14, 0.7, 0.14], 0.02, [x * (width / 2 - 0.22), 0, z * (depth / 2 - 0.22)]);
  }
  b.round('poolRail', [width - 0.1, 0.16, depth - 0.1], 0.02, [0, 0.58, 0]);
  b.box('poolCloth', [width - rail * 2 + 0.02, 0.08, depth - rail * 2 + 0.02], [0, 0.74, 0]);
  // Rails: long ones, short ones, and a lighter cushion strip along the cloth edge.
  b.round('poolRail', [width, 0.09, rail], 0.02, [0, 0.76, -depth / 2 + rail / 2]);
  b.round('poolRail', [width, 0.09, rail], 0.02, [0, 0.76, depth / 2 - rail / 2]);
  for (const x of [-1, 1]) b.round('poolRail', [rail, 0.09, depth - rail * 2], 0.02, [x * (width / 2 - rail / 2), 0.76, 0]);
  for (const z of [-1, 1]) b.box('poolCloth', [width - rail * 2 - 0.2, 0.03, 0.03], [0, 0.82, z * (depth / 2 - rail - 0.015)]);
  for (const x of [-1, 1]) b.box('poolCloth', [0.03, 0.03, depth - rail * 2 - 0.2], [x * (width / 2 - rail - 0.015), 0.82, 0]);
  // Pockets.
  const px = width / 2 - rail * 0.75;
  const pz = depth / 2 - rail * 0.75;
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.cyl('black', 0.065, 0.065, 0.012, [x * px, 0.825, z * pz], 12);
  for (const z of [-1, 1]) b.cyl('black', 0.06, 0.06, 0.012, [0, 0.825, z * (depth / 2 - rail * 0.6)], 12);
  // Diamond sights on the rails.
  for (const x of [-0.9, -0.45, 0.45, 0.9]) {
    for (const z of [-1, 1]) b.box('paper', [0.03, 0.005, 0.03], [x, 0.855, z * (depth / 2 - rail / 2)]);
  }
  // Chalk and a triangle rack on the cloth edge.
  b.box('artBlue', [0.04, 0.03, 0.04], [width / 2 - rail - 0.15, 0.82, depth / 2 - rail - 0.1]);
  // Hanging lamp: two cables to the wall-top height, a housing and a lit strip underneath.
  for (const x of [-0.8, 0.8]) b.cyl('darkGrey', 0.007, 0.007, 0.8, [x, 1.9, 0], 4);
  b.round('poolCloth', [width - 0.7, 0.1, 0.36], 0.03, [0, 1.84, 0]);
  b.box('lamp', [width - 0.9, 0.02, 0.28], [0, 1.83, 0]);
  return b.done();
}

/** Wall cue rack, board facing +z, with a few cues. */
export function cueRackParts(width: number): Part[] {
  const b = new PartBuilder();
  b.round('poolRail', [width, 1.25, 0.04], 0.01, [0, 0.35, -0.12]);
  b.box('poolRail', [width, 0.05, 0.12], [0, 0.62, -0.06]);
  b.box('poolRail', [width, 0.05, 0.12], [0, 1.2, -0.06]);
  for (let i = 0; i < 5; i++) {
    const x = -width / 2 + 0.14 + i * ((width - 0.28) / 4);
    b.cyl('woodLight', 0.009, 0.014, 1.38, [x, 0.25, -0.05], 6, { rz: 0.0 });
    b.cyl('poolRail', 0.015, 0.015, 0.25, [x, 0.25, -0.05], 6);
  }
  b.box('paper', [0.18, 0.18, 0.02], [width / 2 - 0.15, 0.2, -0.05]);
  return b.done();
}

/** Table football body: field, side walls, goals, legs. Rods, handles and players are a separate rig. */
export function foosballBodyParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.round('darkGrey', [0.07, 0.78, 0.07], 0.012, [x * (width / 2 - 0.08), 0, z * (depth / 2 - 0.08)]);
  }
  b.round('woodDark', [width, 0.14, depth], 0.02, [0, 0.72, 0]);
  b.box('foosField', [width - 0.14, 0.012, depth - 0.14], [0, 0.862, 0]);
  // Field markings: centre line and circle, penalty boxes.
  b.box('paper', [0.012, 0.004, depth - 0.14], [0, 0.874, 0]);
  b.cyl('paper', 0.11, 0.11, 0.004, [0, 0.872, 0], 20);
  b.cyl('foosField', 0.1, 0.1, 0.005, [0, 0.8735, 0], 20);
  for (const x of [-1, 1]) {
    b.box('paper', [0.012, 0.004, 0.32], [x * (width / 2 - 0.3), 0.874, 0]);
    b.box('black', [0.04, 0.05, 0.22], [x * (width / 2 - 0.075), 0.87, 0]);
  }
  // Walls and top rails.
  for (const z of [-1, 1]) b.round('woodDark', [width, 0.1, 0.07], 0.015, [0, 0.82, z * (depth / 2 - 0.035)]);
  for (const x of [-1, 1]) b.round('woodDark', [0.07, 0.1, depth - 0.14], 0.015, [x * (width / 2 - 0.035), 0.82, 0]);
  return b.done();
}

/** TV cabinet with a console, controllers and the TV body on it; the lit screen is separate. Front toward +z. */
export function tvStandParts(width: number): Part[] {
  const b = new PartBuilder();
  b.round('woodDark', [width, 0.4, 0.5], 0.02, [0, 0.05, 0]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.cyl('darkGrey', 0.025, 0.02, 0.06, [x * (width / 2 - 0.1), 0, z * 0.19], 6);
  b.box('cabinetDoor', [width / 2 - 0.08, 0.3, 0.012], [-width / 4, 0.1, 0.255]);
  b.box('cabinetDoor', [width / 2 - 0.08, 0.3, 0.012], [width / 4, 0.1, 0.255]);
  b.round('woodTop', [width + 0.04, 0.03, 0.54], 0.01, [0, 0.45, 0]);
  // Console, controllers and a game case.
  b.round('white', [0.36, 0.06, 0.26], 0.02, [-width / 2 + 0.3, 0.48, 0.05]);
  b.box('lamp', [0.04, 0.006, 0.01], [-width / 2 + 0.3, 0.538, 0.18]);
  b.round('black', [0.12, 0.03, 0.07], 0.015, [width / 2 - 0.3, 0.48, 0.12], { ry: 0.3 });
  b.round('artRed', [0.12, 0.03, 0.07], 0.015, [width / 2 - 0.45, 0.48, 0.14], { ry: -0.2 });
  // TV: neck, stand, panel (front is the lit screen plane).
  b.cyl('darkGrey', 0.1, 0.12, 0.02, [0, 0.48, -0.1], 12);
  b.box('darkGrey', [0.05, 0.2, 0.03], [0, 0.5, -0.12]);
  b.round('black', [1.18, 0.7, 0.05], 0.02, [0, 0.64, -0.14]);
  return b.done();
}

const BOX_COLORS = ['artRed', 'artBlue', 'artYellow', 'artGreen', 'parcelKraft', 'rugPlum', 'rugTeal'] as const;

/** Bookcase 1.5 x 0.5 x 1.7 with board-game boxes, front toward +z. */
export function gameShelfParts(seed: number): Part[] {
  const b = new PartBuilder();
  const rand = seeded(seed * 53 + 5);
  const width = 1.5;
  const depth = 0.5;
  const height = 1.7;
  const rows = 4;
  b.box('woodDark', [width, height, 0.02], [0, 0, -depth / 2 + 0.01]);
  for (const x of [-1, 1]) b.box('woodLight', [0.04, height, depth], [x * (width / 2 - 0.02), 0, 0]);
  const cell = (height - 0.1) / rows;
  for (let r = 0; r <= rows; r++) b.box('woodLight', [width, 0.04, depth], [0, 0.04 + r * cell - (r === rows ? 0.04 : 0), 0]);
  for (let r = 0; r < rows; r++) {
    const y = 0.08 + r * cell;
    let x = -width / 2 + 0.07;
    while (x < width / 2 - 0.2) {
      const color = BOX_COLORS[Math.floor(rand() * BOX_COLORS.length)] ?? 'artRed';
      if (rand() < 0.25) {
        const w = 0.28 + rand() * 0.1;
        b.box(color, [w, 0.05, 0.28], [x + w / 2, y, 0.02]);
        b.box('paper', [w - 0.06, 0.012, 0.2], [x + w / 2, y + 0.05, 0.02]);
        x += w + 0.04;
      } else {
        const w = 0.06 + rand() * 0.05;
        const h = cell * (0.62 + rand() * 0.2);
        b.box(color, [w, h, 0.3], [x + w / 2, y, 0.02]);
        x += w + 0.01;
      }
    }
  }
  return b.done();
}
