import { type Part, PartBuilder } from './kit';

/** Reception desk for the approvals counter, customers on the +z side. */
export function receptionParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.round('receptionBody', [width, 1.0, depth], 0.04, [0, 0, 0]);
  b.round('receptionTop', [width + 0.12, 0.05, depth + 0.12], 0.02, [0, 1.0, 0]);
  b.box('receptionTop', [width - 0.3, 0.35, 0.02], [0, 0.5, depth / 2 + 0.006]);
  b.box('counterTop', [width - 0.1, 0.06, 0.02], [0, 0.08, depth / 2 + 0.006]);
  // Low work surface behind the ledge, with a monitor, stamp and tray
  b.box('receptionTop', [width - 0.4, 0.04, 0.3], [0, 0.78, -depth / 2 - 0.1]);
  b.box('darkGrey', [0.04, 0.78, 0.04], [-width / 2 + 0.3, 0, -depth / 2 - 0.2]);
  b.box('darkGrey', [0.04, 0.78, 0.04], [width / 2 - 0.3, 0, -depth / 2 - 0.2]);
  b.round('black', [0.45, 0.28, 0.03], 0.01, [-0.7, 1.12, -0.1], { ry: Math.PI });
  b.box('darkGrey', [0.04, 0.12, 0.04], [-0.7, 1.05, -0.1]);
  b.box('darkGrey', [0.12, 0.012, 0.1], [-0.7, 1.05, -0.1]);
  b.box('paper', [0.24, 0.05, 0.32], [0.9, 1.05, 0.0]);
  b.box('artGreen', [0.24, 0.012, 0.32], [0.9, 1.1, 0.0], { ry: 0.1 });
  b.cyl('steel', 0.06, 0.07, 0.025, [0.2, 1.05, 0.15], 12);
  b.sphere('steel', 0.04, [0.2, 1.08, 0.15], [1, 0.6, 1], 8);
  b.cyl('artRed', 0.04, 0.04, 0.09, [-0.2, 1.05, 0.12], 10);
  b.cyl('darkGrey', 0.1, 0.12, 0.02, [1.3, 1.05, -0.05], 10);
  b.cyl('darkGrey', 0.012, 0.012, 0.28, [1.3, 1.06, -0.05], 6);
  b.cyl('lamp', 0.07, 0.1, 0.1, [1.3, 1.32, -0.1], 10, { rx: 0.4 });
  return b.done();
}

export function stanchionParts(): Part[] {
  const b = new PartBuilder();
  b.cyl('steel', 0.14, 0.15, 0.03, [0, 0, 0], 14);
  b.cyl('steel', 0.025, 0.025, 0.88, [0, 0.03, 0], 8);
  b.sphere('steel', 0.045, [0, 0.93, 0], [1, 1, 1], 8);
  return b.done();
}
