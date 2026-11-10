import { type Part, PartBuilder } from './kit';

/** Long lunch table; `width` runs along x, `length` along z. Condiments sit in the middle. */
export function lunchTableParts(width: number, length: number): Part[] {
  const b = new PartBuilder();
  b.round('woodLight', [width, 0.05, length], 0.015, [0, 0.72, 0]);
  b.box('woodDark', [width - 0.1, 0.04, length - 0.3], [0, 0.66, 0]);
  for (const z of [-length / 2 + 0.55, length / 2 - 0.55]) {
    b.box('woodDark', [width - 0.18, 0.05, 0.08], [0, 0.0, z]);
    for (const x of [-1, 1]) b.box('woodDark', [0.06, 0.72, 0.08], [x * (width / 2 - 0.12), 0, z]);
  }
  b.box('woodDark', [0.06, 0.06, length - 1.0], [0, 0.18, 0]);
  // Table centre: napkin holder, salt, a flower pot.
  for (const z of [-1.2, 0.5, 1.4]) {
    b.box('paper', [0.1, 0.1, 0.08], [0.0, 0.77, z]);
    b.cyl('white', 0.022, 0.022, 0.07, [0.1, 0.77, z + 0.05], 8);
    b.cyl('artRed', 0.02, 0.02, 0.06, [-0.1, 0.77, z - 0.05], 8);
  }
  b.cyl('potTeal', 0.05, 0.04, 0.08, [0, 0.77, -0.35], 10);
  b.sphere('leaf', 0.07, [0, 0.9, -0.35], [1, 0.9, 1], 8);
  return b.done();
}

/** Dining chair, seat faces +z, back at -z; seat and back take the instance colour. */
export function diningChairParts(): Part[] {
  const b = new PartBuilder();
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.box('woodDark', [0.04, 0.42, 0.04], [x * 0.19, 0, z * 0.19]);
  }
  b.round('tint', [0.44, 0.05, 0.44], 0.02, [0, 0.42, 0]);
  b.round('tint', [0.42, 0.34, 0.04], 0.015, [0, 0.5, -0.2], { rx: -0.08 });
  for (const x of [-1, 1]) b.box('woodDark', [0.035, 0.5, 0.035], [x * 0.19, 0.42, -0.2]);
  return b.done();
}
