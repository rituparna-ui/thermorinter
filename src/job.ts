/** Assemble a complete print job (header + rows + footer) into one byte stream. */
import * as proto from "./protocol";

export interface JobOptions {
  /** Darkness 0..65535 (default 0x3000). */
  energy?: number;
  /** Paper feed lines after the job (default 80; 0 = none). */
  feedLines?: number;
  /** Quality byte (default 0x33). */
  quality?: number;
  /** Drawing mode (default image). */
  mode?: number;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Build the command stream to print an array of 48-byte row payloads.
 * @param rows packed rows (each 48 bytes), e.g. from render.ts / image.ts
 */
export function buildJob(rows: Uint8Array[], opts: JobOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(proto.getDeviceState());
  parts.push(proto.setQuality(opts.quality ?? 0x33));
  parts.push(proto.latticeStart());
  parts.push(proto.setEnergy(opts.energy ?? 0x3000));
  parts.push(proto.drawingMode(opts.mode ?? proto.DrawingMode.Image));
  parts.push(proto.setSpeed(0x1e));
  for (const r of rows) parts.push(proto.command(proto.Cmd.DrawBitmap, r));
  parts.push(proto.latticeEnd());
  const feed = opts.feedLines ?? 80;
  if (feed > 0) parts.push(proto.feedPaper(feed));
  parts.push(proto.getDeviceState());
  return concat(parts);
}
