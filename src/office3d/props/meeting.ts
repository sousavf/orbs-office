import { type Part, PartBuilder } from './kit';

/** Conference table of the given size, front toward +z. */
export function meetingTableParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.round('woodTop', [width, 0.05, depth], 0.02, [0, 0.72, 0]);
  const half = width / 2 - 0.35;
  for (const side of [-1, 1]) {
    b.box('woodDark', [0.08, 0.72, depth - 0.2], [side * half, 0, 0]);
    b.box('darkGrey', [0.1, 0.03, depth - 0.1], [side * half, 0, 0]);
  }
  b.box('woodDark', [width - 1.2, 0.06, 0.1], [0, 0.62, 0]);
  // Table-top clutter: speaker puck, notebooks, a water jug
  b.cyl('black', 0.1, 0.11, 0.035, [0, 0.77, 0], 14);
  b.cyl('steel', 0.06, 0.06, 0.012, [0, 0.805, 0], 14);
  b.box('paper', [0.22, 0.012, 0.3], [-width * 0.28, 0.77, depth * 0.18], { ry: 0.25 });
  b.box('artBlue', [0.22, 0.012, 0.3], [width * 0.3, 0.77, -depth * 0.15], { ry: -0.2 });
  b.cyl('waterBlue', 0.05, 0.05, 0.2, [width * 0.12, 0.77, depth * 0.2], 10);
  return b.done();
}

/** Free-standing whiteboard on an easel, board faces +z. */
export function whiteboardParts(): Part[] {
  const b = new PartBuilder();
  b.box('darkGrey', [1.5, 0.04, 0.05], [0, 0.9, 0]);
  b.round('board', [1.4, 0.9, 0.03], 0.01, [0, 1.0, 0]);
  b.box('steel', [0.05, 1.0, 0.04], [-0.65, 0, -0.1], { rx: 0.0 });
  b.box('steel', [0.05, 1.0, 0.04], [0.65, 0, -0.1]);
  b.box('darkGrey', [1.4, 0.03, 0.3], [0, 0.02, -0.1]);
  b.box('artRed', [0.5, 0.015, 0.02], [-0.3, 1.5, 0.017]);
  b.box('artBlue', [0.4, 0.015, 0.02], [-0.35, 1.38, 0.017]);
  b.box('artGreen', [0.3, 0.015, 0.02], [0.3, 1.45, 0.017]);
  b.box('darkGrey', [0.4, 0.025, 0.06], [0, 0.88, 0.06]);
  return b.done();
}
