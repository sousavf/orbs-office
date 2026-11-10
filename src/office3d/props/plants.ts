import { type Part, PartBuilder, seeded } from './kit';

export const PLANT_TYPES = 6;

/** Potted plants. Type picks the species and pot; all are about 1.0 to 1.5 m tall. */
export function plantParts(type: number): Part[] {
  const b = new PartBuilder();
  const rand = seeded(type * 31 + 7);
  const kind = ((type % PLANT_TYPES) + PLANT_TYPES) % PLANT_TYPES;
  const pot = kind % 3 === 0 ? 'pot' : kind % 3 === 1 ? 'potWhite' : 'potTeal';
  b.cyl(pot, 0.24, 0.17, 0.4, [0, 0, 0], 14);
  b.cyl('soil', 0.22, 0.22, 0.02, [0, 0.39, 0], 14);
  if (kind === 0) {
    // Fiddle-leaf: thin trunk, big flat leaves
    b.cyl('woodDark', 0.025, 0.035, 0.7, [0, 0.4, 0], 6);
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      b.sphere(i % 2 ? 'leaf' : 'leafDark', 0.15, [Math.sin(a) * 0.14, 0.85 + i * 0.1, Math.cos(a) * 0.14], [1, 0.35, 0.8], 8);
    }
  } else if (kind === 1) {
    // Bushy ficus
    b.cyl('woodDark', 0.03, 0.04, 0.4, [0, 0.4, 0], 6);
    b.sphere('leaf', 0.36, [0, 1.0, 0], [1, 0.95, 1], 10);
    b.sphere('leafLight', 0.24, [0.18, 1.2, 0.06], [1, 1, 1], 9);
    b.sphere('leafDark', 0.22, [-0.17, 1.12, -0.08], [1, 1, 1], 9);
  } else if (kind === 2) {
    // Snake plant: upright blades
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand();
      const lean = 0.08 + rand() * 0.14;
      b.cone(i % 3 === 0 ? 'leafLight' : 'leafDark', 0.06, 0.55 + rand() * 0.5, [Math.sin(a) * 0.08, 0.4, Math.cos(a) * 0.08], {
        rx: Math.cos(a) * lean,
        rz: -Math.sin(a) * lean,
      });
    }
  } else if (kind === 3) {
    // Palm: trunk with arching fronds
    b.cyl('woodDark', 0.03, 0.045, 0.9, [0, 0.4, 0], 6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.sphere(i % 2 ? 'leaf' : 'leafLight', 0.28, [Math.sin(a) * 0.3, 1.3 - (i % 2) * 0.06, Math.cos(a) * 0.3], [0.55, 0.12, 0.55]);
    }
    b.sphere('leafDark', 0.14, [0, 1.38, 0], [1, 0.6, 1], 8);
  } else if (kind === 4) {
    // Low cheerful round shrub with berries
    b.sphere('leafLight', 0.3, [0, 0.62, 0], [1, 0.85, 1], 10);
    b.sphere('leaf', 0.22, [0.15, 0.82, 0.05], [1, 0.9, 1], 9);
    for (let i = 0; i < 5; i++) {
      b.sphere('artRed', 0.04, [Math.sin(i * 1.3) * 0.26, 0.7 + (i % 2) * 0.12, Math.cos(i * 1.3) * 0.26], [1, 1, 1], 6);
    }
  } else {
    // Tall grass tuft
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const lean = 0.2 + rand() * 0.25;
      b.cone(i % 2 ? 'leaf' : 'leafLight', 0.035, 0.7 + rand() * 0.5, [Math.sin(a) * 0.06, 0.4, Math.cos(a) * 0.06], {
        rx: Math.cos(a) * lean,
        rz: -Math.sin(a) * lean,
      });
    }
  }
  return b.done();
}

export function coolerParts(): Part[] {
  const b = new PartBuilder();
  b.round('white', [0.38, 0.95, 0.38], 0.04, [0, 0, 0]);
  b.box('steel', [0.18, 0.02, 0.04], [0, 0.7, 0.2]);
  b.box('waterBlue', [0.03, 0.05, 0.03], [-0.07, 0.62, 0.2]);
  b.box('artRed', [0.03, 0.05, 0.03], [0.07, 0.62, 0.2]);
  b.cyl('waterBlue', 0.15, 0.15, 0.4, [0, 0.95, 0], 14);
  b.sphere('waterBlue', 0.15, [0, 1.35, 0], [1, 0.45, 1], 12);
  b.cyl('white', 0.04, 0.035, 0.07, [0.3, 0.0, 0.2], 8);
  return b.done();
}
