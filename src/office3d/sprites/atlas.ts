import {
  type Texture,
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { headAtlasTexture } from './heads';
import { isColouredSheet, paintSheet } from './paint';
import { frameTable } from './poses';
import { ATLAS_W, CELL_H, CELL_W, type PoseSet, type SheetKind, atlasHeight } from './sprite.types';

/**
 * Character sprite sheets as GPU textures, created the first time a figure needs them.
 *
 * Sheets that keep their own colours (legs, hands) are RGBA8 canvas textures. Tinted sheets
 * (shirt, dresses, accent) hold only a premultiplied grey and the alpha, so they use two bytes a
 * pixel. A full set of eight sheets is about 33 MB with mipmaps; a male-only office needs three (15 MB).
 */

const du = CELL_W / ATLAS_W;

function buildRects(set: PoseSet): Float32Array {
  const table = frameTable(set);
  const dv = CELL_H / atlasHeight(set);
  const rects = new Float32Array(table.length * 4);
  table.forEach((entry, slot) => {
    rects.set([entry.col * du, 1 - (entry.row + 1) * dv, du, dv], slot * 4);
  });
  return rects;
}

const RECTS: Readonly<Record<PoseSet, Float32Array>> = { base: buildRects('base'), activity: buildRects('activity') };

/** Per-frame (u, v, du, dv) in every sheet's UV space of a pose set, indexed by frame slot * 4. */
export function frameRects(set: PoseSet): Float32Array {
  return RECTS[set];
}


function colouredTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

/** Packs a grey-and-alpha canvas into a two-channel texture with premultiplied grey, rows flipped for GL. */
function tintTexture(canvas: HTMLCanvasElement): DataTexture {
  const atlasH = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = new Uint8Array(ATLAS_W * atlasH * 2);
  if (ctx !== null) {
    const pixels = ctx.getImageData(0, 0, ATLAS_W, atlasH).data;
    for (let y = 0; y < atlasH; y += 1) {
      const destRow = (atlasH - 1 - y) * ATLAS_W;
      for (let x = 0; x < ATLAS_W; x += 1) {
        const src = (y * ATLAS_W + x) * 4;
        const alpha = pixels[src + 3] ?? 0;
        const dest = (destRow + x) * 2;
        data[dest] = Math.round(((pixels[src] ?? 0) * alpha) / 255);
        data[dest + 1] = alpha;
      }
    }
  }
  const texture = new DataTexture(data, ATLAS_W, atlasH, RGFormat, UnsignedByteType);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export class SpriteAtlas {
  private readonly sheets = new Map<string, Texture>();
  private heads: Texture | null = null;

  /** One sheet of a pose set; the activity set is painted the first time something asks for it. */
  sheet(kind: SheetKind, set: PoseSet = 'base'): Texture {
    const key = `${set}:${kind}`;
    const cached = this.sheets.get(key);
    if (cached !== undefined) return cached;
    const canvas = paintSheet(kind, set);
    const texture = isColouredSheet(kind) ? colouredTexture(canvas) : tintTexture(canvas);
    this.sheets.set(key, texture);
    return texture;
  }

  headAtlas(): Texture {
    this.heads ??= headAtlasTexture();
    return this.heads;
  }

  /** Texture memory held right now, in bytes (mipmaps included). */
  get bytes(): number {
    let total = this.heads === null ? 0 : 256 * 256 * 4 * 1.34;
    for (const key of this.sheets.keys()) {
      const [set, kind] = key.split(':') as [PoseSet, SheetKind];
      total += ATLAS_W * atlasHeight(set) * (isColouredSheet(kind) ? 4 : 2) * 1.34;
    }
    return Math.round(total);
  }

  dispose(): void {
    for (const texture of this.sheets.values()) texture.dispose();
    this.sheets.clear();
    this.heads?.dispose();
    this.heads = null;
  }
}
