import { type Part, PartBuilder } from './kit';

const COUNTER_HEIGHT = 0.9;

/** Base-cabinet run of `length` x `depth`, doors toward +z. */
export function counterParts(length: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.box('darkGrey', [length - 0.04, 0.1, depth - 0.06], [0, 0, -0.01]);
  b.box('counterBody', [length, 0.76, depth - 0.02], [0, 0.1, -0.01]);
  const doors = Math.round(length / 0.5);
  const width = length / doors;
  for (let i = 0; i < doors; i++) {
    const x = -length / 2 + width * (i + 0.5);
    b.round('cabinetDoor', [width - 0.03, 0.7, 0.02], 0.006, [x, 0.13, depth / 2 - 0.02]);
    b.box('steel', [0.1, 0.018, 0.018], [x, 0.7, depth / 2 + 0.005]);
  }
  b.round('counterTop', [length + 0.04, 0.04, depth + 0.04], 0.01, [0, 0.86, -0.01]);
  b.box('counterTop', [length - 0.2, 0.2, 0.03], [0, COUNTER_HEIGHT, -depth / 2 + 0.03]);
  return b.done();
}

export function sinkCounterParts(length: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.add(counterParts(length, depth));
  b.box('steel', [0.7, 0.012, 0.4], [0, COUNTER_HEIGHT, 0.0]);
  b.box('darkGrey', [0.62, 0.014, 0.32], [0, COUNTER_HEIGHT + 0.001, 0.0]);
  b.cyl('steel', 0.016, 0.016, 0.28, [0, COUNTER_HEIGHT, -0.2], 8);
  b.cyl('steel', 0.012, 0.012, 0.16, [0, COUNTER_HEIGHT + 0.26, -0.12], 8, { rx: Math.PI / 2 });
  // Dish rack and a dish towel
  b.box('white', [0.34, 0.014, 0.26], [0.7, COUNTER_HEIGHT, 0.0]);
  b.box('rugCoral', [0.3, 0.01, 0.2], [-0.75, COUNTER_HEIGHT, 0.02]);
  return b.done();
}

export function fridgeParts(): Part[] {
  const b = new PartBuilder();
  b.round('fridge', [0.9, 1.88, 0.7], 0.05, [0, 0.04, 0]);
  b.box('darkGrey', [0.8, 0.05, 0.6], [0, 0, 0]);
  b.box('darkGrey', [0.86, 0.012, 0.02], [0, 0.7, 0.355]);
  b.round('steel', [0.03, 0.4, 0.04], 0.012, [-0.36, 0.95, 0.38]);
  b.round('steel', [0.03, 0.22, 0.04], 0.012, [-0.36, 0.38, 0.38]);
  b.box('artRed', [0.07, 0.07, 0.015], [0.2, 1.5, 0.356], { ry: 0.0 });
  b.box('artYellow', [0.06, 0.08, 0.015], [0.3, 1.38, 0.356]);
  b.box('paper', [0.16, 0.2, 0.012], [0.12, 1.2, 0.356]);
  return b.done();
}

/** Espresso machine; its base sits on the counter top. */
export function coffeeMachineParts(): Part[] {
  const b = new PartBuilder();
  const y = COUNTER_HEIGHT + 0.04;
  b.round('coffeeBody', [0.34, 0.38, 0.34], 0.03, [0, y, 0]);
  b.round('darkGrey', [0.36, 0.05, 0.36], 0.015, [0, y + 0.38, 0]);
  b.box('steel', [0.24, 0.015, 0.2], [0, y, 0.2]);
  b.cyl('steel', 0.025, 0.025, 0.08, [-0.07, y + 0.22, 0.17], 8);
  b.cyl('steel', 0.025, 0.025, 0.08, [0.07, y + 0.22, 0.17], 8);
  b.cyl('white', 0.04, 0.032, 0.07, [0, y + 0.015, 0.2], 10);
  b.box('black', [0.22, 0.1, 0.01], [0, y + 0.26, 0.172]);
  b.cyl('white', 0.05, 0.05, 0.03, [0.35, y - 0.04, -0.05], 12);
  return b.done();
}

export function roundTableParts(diameter: number): Part[] {
  const r = diameter / 2;
  const b = new PartBuilder();
  b.cyl('woodTop', r, r, 0.04, [0, 0.74, 0], 24);
  b.cyl('woodDark', 0.05, 0.05, 0.74, [0, 0, 0], 10);
  b.cyl('woodDark', 0.28, 0.3, 0.03, [0, 0, 0], 16);
  b.cyl('white', 0.04, 0.035, 0.08, [0.15, 0.78, 0.1], 10);
  b.cyl('leaf', 0.0, 0.05, 0.12, [0.15, 0.86, 0.1], 6);
  return b.done();
}

/** Three-seat sofa, front toward +z. */
export function sofaParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  const armW = 0.22;
  const seatW = width - armW * 2;
  b.round('sofa', [width, 0.3, depth], 0.05, [0, 0.12, 0]);
  b.round('sofa', [width, 0.5, 0.22], 0.08, [0, 0.3, -depth / 2 + 0.11]);
  for (const side of [-1, 1]) b.round('sofa', [armW, 0.3, depth], 0.08, [side * (width / 2 - armW / 2), 0.3, 0]);
  const cushionW = seatW / 3;
  for (let i = 0; i < 3; i++) {
    b.round('cushionLight', [cushionW - 0.02, 0.12, depth - 0.3], 0.04, [-seatW / 2 + cushionW * (i + 0.5), 0.42, 0.08]);
  }
  b.round('cushionA', [0.36, 0.34, 0.1], 0.04, [-seatW / 2 + 0.25, 0.5, -0.12], { rx: -0.35 });
  b.round('cushionB', [0.34, 0.32, 0.1], 0.04, [seatW / 2 - 0.25, 0.5, -0.12], { rx: -0.3, rz: 0.1 });
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.cyl('woodDark', 0.03, 0.025, 0.12, [x * (width / 2 - 0.12), 0, z * (depth / 2 - 0.1)], 6);
  }
  return b.done();
}

export function coffeeTableParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.round('woodLight', [width, 0.04, depth], 0.015, [0, 0.4, 0]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.cyl('woodDark', 0.025, 0.02, 0.4, [x * (width / 2 - 0.08), 0, z * (depth / 2 - 0.08)], 6);
  }
  b.box('artRed', [0.26, 0.015, 0.2], [-0.2, 0.44, 0.0], { ry: 0.3 });
  b.cyl('white', 0.045, 0.04, 0.08, [0.25, 0.44, 0.05], 10);
  return b.done();
}

export function sideTableParts(): Part[] {
  const b = new PartBuilder();
  b.cyl('woodLight', 0.25, 0.25, 0.04, [0, 0.5, 0], 16);
  b.cyl('woodDark', 0.03, 0.03, 0.5, [0, 0, 0], 8);
  b.cyl('woodDark', 0.17, 0.19, 0.03, [0, 0, 0], 12);
  b.cyl('potTeal', 0.07, 0.055, 0.1, [0, 0.54, 0], 10);
  b.sphere('leaf', 0.1, [0, 0.72, 0], [1, 0.9, 1], 8);
  return b.done();
}

export function floorLampParts(): Part[] {
  const b = new PartBuilder();
  b.cyl('darkGrey', 0.14, 0.15, 0.03, [0, 0, 0], 14);
  b.cyl('darkGrey', 0.014, 0.014, 1.45, [0, 0.03, 0], 6);
  b.cyl('lamp', 0.1, 0.18, 0.28, [0, 1.4, 0], 14);
  return b.done();
}
