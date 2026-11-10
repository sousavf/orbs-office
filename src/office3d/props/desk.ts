import { type Part, PartBuilder } from './kit';

/** Desk 1.5 x 0.8 m, front (chair side) toward +z, monitor at the back. */
export function deskParts(): Part[] {
  const b = new PartBuilder();
  b.round('woodTop', [1.5, 0.04, 0.8], 0.012, [0, 0.7, 0]);
  b.box('woodDark', [0.04, 0.7, 0.7], [-0.7, 0, 0]);
  b.box('woodDark', [1.0, 0.32, 0.02], [-0.18, 0.36, -0.34]);
  b.round('woodLight', [0.42, 0.66, 0.7], 0.01, [0.52, 0.04, 0]);
  b.box('woodDark', [0.42, 0.04, 0.7], [0.52, 0, 0]);
  b.box('cabinetDoor', [0.37, 0.27, 0.012], [0.52, 0.4, 0.352]);
  b.box('cabinetDoor', [0.37, 0.27, 0.012], [0.52, 0.09, 0.352]);
  b.box('steel', [0.12, 0.02, 0.02], [0.52, 0.6, 0.364]);
  b.box('steel', [0.12, 0.02, 0.02], [0.52, 0.29, 0.364]);
  // Monitor
  b.cyl('darkGrey', 0.09, 0.1, 0.012, [-0.15, 0.74, -0.18]);
  b.box('darkGrey', [0.035, 0.17, 0.025], [-0.15, 0.752, -0.2]);
  b.round('black', [0.6, 0.35, 0.03], 0.01, [-0.15, 0.88, -0.2]);
  b.box('screen', [0.55, 0.3, 0.004], [-0.15, 0.905, -0.1835]);
  // Desk lamp: a weighted base, a slim arm and a shade that glows when somebody sits here at night.
  b.cyl('darkGrey', 0.055, 0.06, 0.016, [0.44, 0.74, -0.27], 12);
  b.box('darkGrey', [0.014, 0.2, 0.014], [0.44, 0.756, -0.27]);
  b.box('darkGrey', [0.014, 0.014, 0.15], [0.44, 0.95, -0.2]);
  b.cyl('deskLamp', 0.03, 0.08, 0.075, [0.44, 0.88, -0.13], 12);
  // Keyboard, mouse, notepad
  b.round('darkGrey', [0.42, 0.018, 0.14], 0.006, [-0.15, 0.74, 0.12]);
  b.box('paper', [0.4, 0.004, 0.025], [-0.15, 0.758, 0.085]);
  b.round('white', [0.055, 0.022, 0.095], 0.01, [0.2, 0.74, 0.12]);
  b.box('paper', [0.2, 0.006, 0.28], [-0.58, 0.74, 0.1], { ry: 0.2 });
  b.box('artBlue', [0.08, 0.012, 0.01], [-0.58, 0.746, 0.02], { ry: 0.2 });
  return b.done();
}

/** Desk mug, tinted per instance. Sits at the right-hand corner of a desk. */
export function mugParts(): Part[] {
  const b = new PartBuilder();
  b.cyl('tint', 0.04, 0.035, 0.09, [0.38, 0.74, 0.18], 12);
  b.box('tint', [0.012, 0.05, 0.03], [0.425, 0.76, 0.18]);
  return b.done();
}

export function deskPlantParts(): Part[] {
  const b = new PartBuilder();
  b.cyl('potWhite', 0.05, 0.04, 0.09, [0.62, 0.74, -0.25], 10);
  b.sphere('leaf', 0.07, [0.62, 0.9, -0.25], [1, 1.1, 1], 8);
  b.sphere('leafLight', 0.05, [0.66, 0.96, -0.23], [1, 1, 1], 8);
  return b.done();
}

export function dividerParts(width: number): Part[] {
  const b = new PartBuilder();
  b.round('divider', [width, 0.32, 0.04], 0.012, [0, 0.74, 0]);
  return b.done();
}

/** Office swivel chair; seat faces +z. `tint` parts take the per-instance colour. */
export function chairParts(): Part[] {
  const b = new PartBuilder();
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const x = Math.sin(angle) * 0.13;
    const z = Math.cos(angle) * 0.13;
    b.box('black', [0.04, 0.025, 0.28], [x, 0.07, z], { ry: angle });
    b.sphere('darkGrey', 0.028, [Math.sin(angle) * 0.26, 0.03, Math.cos(angle) * 0.26], [1, 1, 1], 8);
  }
  b.cyl('darkGrey', 0.025, 0.025, 0.3, [0, 0.08, 0], 8);
  b.round('tint', [0.46, 0.08, 0.46], 0.035, [0, 0.4, 0]);
  b.round('tint', [0.42, 0.44, 0.07], 0.03, [0, 0.52, -0.2], { rx: -0.1 });
  for (const side of [-1, 1]) {
    b.box('black', [0.035, 0.12, 0.035], [side * 0.235, 0.43, 0.0]);
    b.round('black', [0.05, 0.03, 0.28], 0.012, [side * 0.235, 0.54, 0.0]);
  }
  return b.done();
}

export function stoolParts(): Part[] {
  const b = new PartBuilder();
  b.cyl('tint', 0.19, 0.18, 0.06, [0, 0.62, 0], 16);
  b.cyl('steel', 0.2, 0.2, 0.012, [0, 0.61, 0], 16);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.cyl('steel', 0.016, 0.016, 0.62, [Math.sin(angle) * 0.14, 0, Math.cos(angle) * 0.14], 6);
  }
  b.cyl('steel', 0.17, 0.17, 0.012, [0, 0.22, 0], 16);
  return b.done();
}
