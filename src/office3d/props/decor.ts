import type { MatKey } from '../materials';
import { type Part, PartBuilder } from './kit';

const RUG_INNER: readonly MatKey[] = ['rugTeal', 'rugPlum', 'rugCoral', 'rugKraft', 'rugSage', 'rugCream', 'rugCoral'];

export function rugParts(width: number, depth: number, variant: number): Part[] {
  const b = new PartBuilder();
  const inner = RUG_INNER[variant % RUG_INNER.length] ?? 'rugCream';
  b.round('rugBorder', [width, 0.02, depth], 0.008, [0, 0, 0]);
  b.round(inner, [width - 0.24, 0.024, depth - 0.24], 0.008, [0, 0, 0]);
  b.round('rugBorder', [width - 0.5, 0.026, depth - 0.5], 0.008, [0, 0, 0]);
  b.round(inner, [width - 0.58, 0.028, depth - 0.58], 0.008, [0, 0, 0]);
  return b.done();
}

export function doorMatParts(width: number, depth: number): Part[] {
  const b = new PartBuilder();
  b.round('rubber', [width, 0.025, depth], 0.01, [0, 0, 0]);
  b.box('hazard', [width - 0.1, 0.028, 0.04], [0, 0, depth / 2 - 0.06]);
  return b.done();
}

/** Picture frame with a flat abstract composition; origin at bottom centre, facing +z. */
export function artParts(width: number, height: number, variant: number): Part[] {
  const b = new PartBuilder();
  const t = 0.035;
  b.box('frame', [width, height, t], [0, 0, 0]);
  b.box('artCream', [width - 0.1, height - 0.1, t + 0.004], [0, 0.05, 0]);
  const z = t / 2 + 0.004;
  const w = width - 0.2;
  const h = height - 0.2;
  const set = variant % 5;
  if (set === 0) {
    b.cyl('artRed', w * 0.3, w * 0.3, 0.006, [0, h * 0.35 + 0.1, z], 20, { rx: Math.PI / 2 });
    b.box('artBlue', [w, h * 0.22, 0.006], [0, 0.1, z]);
  } else if (set === 1) {
    b.box('artGreen', [w * 0.45, h * 0.6, 0.006], [-w * 0.2, 0.1, z]);
    b.box('artYellow', [w * 0.4, h * 0.4, 0.006], [w * 0.2, h * 0.45 + 0.1, z]);
  } else if (set === 2) {
    b.cyl('artBlue', w * 0.22, w * 0.22, 0.006, [-w * 0.2, h * 0.3 + 0.1, z], 20, { rx: Math.PI / 2 });
    b.cyl('artYellow', w * 0.22, w * 0.22, 0.006, [w * 0.2, h * 0.3 + 0.1, z], 20, { rx: Math.PI / 2 });
    b.box('artRed', [w * 0.8, h * 0.12, 0.006], [0, 0.12, z]);
  } else if (set === 3) {
    for (let i = 0; i < 4; i++) {
      b.box(i % 2 ? 'artGreen' : 'artRed', [w * 0.18, h * (0.35 + i * 0.12), 0.006], [-w * 0.33 + i * w * 0.22, 0.1, z]);
    }
  } else {
    b.cone('artGreen', w * 0.38, h * 0.6, [0, 0.1, z], { rx: Math.PI / 2 }, 3);
    b.cyl('artYellow', w * 0.14, w * 0.14, 0.006, [w * 0.18, h * 0.62 + 0.1, z], 16, { rx: Math.PI / 2 });
  }
  return b.done();
}

/** Window with a sky pane and a cross mullion; origin at bottom centre, facing +z. Variant 1 adds curtains, 2 louvred shutters. */
export function windowParts(width: number, height: number, variant = 0): Part[] {
  const b = new PartBuilder();
  const t = 0.06;
  const f = 0.07;
  b.box('white', [width, height, t], [0, 0, 0]);
  b.box('sky', [width - f * 2, height - f * 2, t + 0.006], [0, f, 0]);
  b.box('white', [f * 0.6, height - f, t + 0.012], [0, f / 2, 0]);
  b.box('white', [width - f, f * 0.6, t + 0.012], [0, height / 2 - f * 0.3, 0]);
  b.box('white', [width + 0.12, 0.05, t + 0.09], [0, -0.05, 0.03]);
  if (variant === 1) {
    const panel = width * 0.3;
    for (const side of [-1, 1]) {
      b.round('curtain', [panel, height + 0.12, 0.04], 0.015, [side * (width / 2 - panel / 2 + 0.02), -0.04, t / 2 + 0.03]);
      for (let i = 1; i < 4; i++) {
        b.box('rugBorder', [0.012, height + 0.1, 0.012], [side * (width / 2 - panel / 2 + 0.02) + (i - 2) * (panel / 4), -0.03, t / 2 + 0.056]);
      }
    }
    b.cyl('darkGrey', 0.012, 0.012, width + 0.3, [0, height + 0.06, t / 2 + 0.04], 6, { rz: Math.PI / 2 });
  } else if (variant === 2) {
    const half = (width - f * 2) / 2;
    for (const side of [-1, 1]) {
      b.box('woodLight', [half, height - f * 2, 0.03], [side * (half / 2), f, t / 2 + 0.02]);
      const slats = Math.round((height - f * 2) / 0.07);
      for (let i = 0; i < slats; i++) b.box('woodDark', [half - 0.04, 0.012, 0.014], [side * (half / 2), f + 0.03 + i * 0.07, t / 2 + 0.042]);
    }
  }
  return b.done();
}

const POSTER_BACKS: readonly MatKey[] = ['artBlue', 'artRed', 'artGreen', 'artYellow', 'rugPlum'];

/** Games-room poster: a bold flat panel with a simple figure; origin at bottom centre, facing +z. */
export function posterParts(width: number, height: number, variant: number): Part[] {
  const b = new PartBuilder();
  const t = 0.025;
  const back = POSTER_BACKS[variant % POSTER_BACKS.length] ?? 'artBlue';
  b.box('frame', [width, height, t], [0, 0, 0]);
  b.box(back, [width - 0.06, height - 0.06, t + 0.004], [0, 0.03, 0]);
  const z = t / 2 + 0.004;
  const w = width - 0.14;
  const h = height - 0.14;
  const kind = variant % 3;
  if (kind === 0) {
    b.cyl('artCream', w * 0.34, w * 0.34, 0.006, [0, h * 0.5 + 0.07, z], 20, { rx: Math.PI / 2 });
    b.box('artCream', [w, h * 0.16, 0.006], [0, 0.07, z]);
  } else if (kind === 1) {
    b.cone('artCream', w * 0.4, h * 0.55, [0, h * 0.35 + 0.07, z], { rx: Math.PI / 2 }, 3);
    b.box('artYellow', [w * 0.6, h * 0.1, 0.006], [0, 0.07, z]);
  } else {
    for (let i = 0; i < 3; i++) b.box('artCream', [w * 0.22, h * (0.3 + i * 0.18), 0.006], [-w * 0.3 + i * w * 0.3, 0.07, z]);
  }
  return b.done();
}
