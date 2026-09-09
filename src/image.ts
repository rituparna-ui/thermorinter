/**
 * Pure image helpers (no DOM) — grayscale conversion, dithering / thresholding,
 * and bit packing to the printer's 48-byte-per-row format. Kept DOM-free so it
 * can be unit tested in Node.
 */
import { BYTES_PER_ROW } from "./protocol";

export interface DitherOptions {
  /** Floyd–Steinberg dithering (default true). If false, hard threshold. */
  dither?: boolean;
  /** Threshold 0..255 used when dither is false (default 128). */
  threshold?: number;
  /** Invert black/white (default false). */
  invert?: boolean;
}

/** Convert RGBA bytes to a grayscale Float32Array, compositing over white. */
export function rgbaToGray(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    const lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    gray[i] = lum * a + 255 * (1 - a); // over white background
  }
  return gray;
}

/** Reduce a grayscale buffer to a 1-bit mono buffer (1 = black dot). */
export function toMono(
  gray: Float32Array,
  width: number,
  height: number,
  opts: DitherOptions = {},
): Uint8Array {
  const { dither = true, threshold = 128, invert = false } = opts;
  const g = Float32Array.from(gray);
  if (invert) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];

  const mono = new Uint8Array(width * height);
  if (!dither) {
    for (let i = 0; i < g.length; i++) mono[i] = g[i] < threshold ? 1 : 0;
    return mono;
  }
  // Floyd–Steinberg error diffusion
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = g[i];
      const nw = old < 128 ? 0 : 255;
      mono[i] = nw === 0 ? 1 : 0;
      const err = old - nw;
      if (x + 1 < width) g[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) g[i + width - 1] += (err * 3) / 16;
        g[i + width] += (err * 5) / 16;
        if (x + 1 < width) g[i + width + 1] += (err * 1) / 16;
      }
    }
  }
  return mono;
}

/**
 * Pack a mono buffer (1 = black) into one Uint8Array per row, LSB-first
 * (bit 0 = leftmost pixel). Rows are the raw 0xA2 payloads.
 */
export function packRows(mono: Uint8Array, width: number, height: number): Uint8Array[] {
  const bytesPerRow = Math.ceil(width / 8);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(bytesPerRow);
    const base = y * width;
    for (let x = 0; x < width; x++) {
      if (mono[base + x]) row[x >> 3] |= 1 << (x & 7);
    }
    rows.push(row);
  }
  return rows;
}

/** Convenience: RGBA ImageData-like -> packed printer rows. */
export function rgbaToRows(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: DitherOptions = {},
): Uint8Array[] {
  const gray = rgbaToGray(rgba, width, height);
  const mono = toMono(gray, width, height, opts);
  const rows = packRows(mono, width, height);
  // sanity: full-width rows must be BYTES_PER_ROW when width === 384
  if (width === 384 && rows.length && rows[0].length !== BYTES_PER_ROW) {
    throw new Error("row packing width mismatch");
  }
  return rows;
}
