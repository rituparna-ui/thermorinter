/**
 * Cat thermal printer protocol (service 0xAE30 / characteristic 0xAE01).
 *
 * Framing:  51 78 <cmd> 00 <len_lo> <len_hi> <payload...> <crc8> ff
 * Checksum: CRC-8, polynomial 0x07, init 0x00, no reflection, over payload.
 * Bitmap row (cmd 0xA2): 48 bytes = 384 px, LSB-first (bit 0x01 = leftmost),
 *   a set bit = a black dot.
 *
 * Verified byte-for-byte against real captures from the reverse-engineered
 * Python implementation.
 */

export const PRINT_WIDTH = 384;
export const BYTES_PER_ROW = PRINT_WIDTH / 8; // 48

export const Cmd = {
  RetractPaper: 0xa0,
  FeedPaper: 0xa1,
  DrawBitmap: 0xa2,
  GetDevState: 0xa3,
  SetQuality: 0xa4,
  ControlLattice: 0xa6,
  GetDevInfo: 0xa8,
  SetEnergy: 0xaf,
  SetSpeed: 0xbd,
  DrawingMode: 0xbe,
} as const;

export const DrawingMode = {
  Image: 0x00,
  Text: 0x01,
} as const;

const LATTICE_START = [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c];
const LATTICE_END = [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17];

/** CRC-8 lookup table for polynomial 0x07. */
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) {
      c = (c & 0x80) !== 0 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    }
    table[i] = c;
  }
  return table;
})();

export function crc8(data: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]!;
  }
  return crc & 0xff;
}

/** Frame a single command: 51 78 cmd 00 len_lo len_hi payload crc ff. */
export function command(cmd: number, payload: ArrayLike<number>): Uint8Array {
  const len = payload.length;
  const out = new Uint8Array(6 + len + 2);
  out[0] = 0x51;
  out[1] = 0x78;
  out[2] = cmd & 0xff;
  out[3] = 0x00;
  out[4] = len & 0xff;
  out[5] = (len >> 8) & 0xff;
  out.set(payload as ArrayLike<number> & Iterable<number>, 6);
  out[6 + len] = crc8(payload);
  out[6 + len + 1] = 0xff;
  return out;
}

export const getDeviceState = (): Uint8Array => command(Cmd.GetDevState, [0x00]);
export const getDeviceInfo = (): Uint8Array => command(Cmd.GetDevInfo, [0x00]);
export const setQuality = (level = 0x33): Uint8Array => command(Cmd.SetQuality, [level & 0xff]);
export const latticeStart = (): Uint8Array => command(Cmd.ControlLattice, LATTICE_START);
export const latticeEnd = (): Uint8Array => command(Cmd.ControlLattice, LATTICE_END);
export const setSpeed = (speed = 0x1e): Uint8Array => command(Cmd.SetSpeed, [speed & 0xff]);
export const drawingMode = (mode: number = DrawingMode.Image): Uint8Array =>
  command(Cmd.DrawingMode, [mode & 0xff]);

export function setEnergy(energy: number): Uint8Array {
  const e = Math.max(0, Math.min(0xffff, energy | 0));
  return command(Cmd.SetEnergy, [e & 0xff, (e >> 8) & 0xff]);
}

export function feedPaper(lines: number): Uint8Array {
  const n = Math.max(0, Math.min(0xffff, lines | 0));
  return command(Cmd.FeedPaper, [n & 0xff, (n >> 8) & 0xff]);
}

/**
 * Pack a 384-length row of booleans (true = black) into 48 bytes, LSB-first
 * (bit 0 = leftmost pixel).
 */
export function encodeRow(rowBits: ArrayLike<boolean | number>): Uint8Array {
  const out = new Uint8Array(BYTES_PER_ROW);
  for (let x = 0; x < PRINT_WIDTH; x++) {
    if (rowBits[x]) {
      out[x >> 3]! |= 1 << (x & 7);
    }
  }
  return out;
}

export const printRow = (rowBits: ArrayLike<boolean | number>): Uint8Array =>
  command(Cmd.DrawBitmap, encodeRow(rowBits));

/** Parse a byte stream into [cmd, payload] frames (used for notifications). */
export function parseFrames(data: Uint8Array): Array<{ cmd: number; payload: Uint8Array }> {
  const frames: Array<{ cmd: number; payload: Uint8Array }> = [];
  let i = 0;
  const n = data.length;
  while (i + 6 <= n) {
    if (data[i] !== 0x51 || data[i + 1] !== 0x78) {
      i += 1;
      continue;
    }
    const cmd = data[i + 2]!;
    const len = data[i + 4]! | (data[i + 5]! << 8);
    const payload = data.slice(i + 6, i + 6 + len);
    frames.push({ cmd, payload });
    i += 6 + len + 2;
  }
  return frames;
}
