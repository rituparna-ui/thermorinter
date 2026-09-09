import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crc8,
  getDeviceState,
  setQuality,
  setEnergy,
  latticeStart,
  latticeEnd,
  feedPaper,
  drawingMode,
  encodeRow,
  parseFrames,
  Cmd,
  rgbaToRows,
  toMono,
  packRows,
} from "../dist/index.js";

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

test("crc8 matches known vectors", () => {
  assert.equal(crc8([0x33]), 0x99);
  assert.equal(crc8([0xe0, 0x2e]), 0x89);
});

test("command framing matches real captures byte-for-byte", () => {
  assert.equal(hex(getDeviceState()), "5178a30001000000ff");
  assert.equal(hex(setQuality(0x33)), "5178a40001003399ff");
  assert.equal(hex(setEnergy(0x2ee0)), "5178af000200e02e89ff");
  assert.equal(hex(latticeStart()), "5178a6000b00aa551738445f5f5f44382ca1ff");
  assert.equal(hex(latticeEnd()), "5178a6000b00aa5517000000000000001711ff");
  assert.equal(hex(feedPaper(0x30)), "5178a10002003000f9ff");
  assert.equal(hex(drawingMode(0)), "5178be0001000000ff");
});

test("encodeRow packs LSB-first, 48 bytes", () => {
  const bits = new Array(384).fill(false);
  bits[0] = true; // leftmost -> byte0 bit0
  bits[7] = true; // -> byte0 bit7 (0x80)
  bits[8] = true; // -> byte1 bit0
  const row = encodeRow(bits);
  assert.equal(row.length, 48);
  assert.equal(row[0], 0x81);
  assert.equal(row[1], 0x01);
});

test("parseFrames round-trips a command", () => {
  const frames = parseFrames(getDeviceState());
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmd, Cmd.GetDevState);
  assert.deepEqual(Array.from(frames[0].payload), [0x00]);
});

test("toMono threshold reduces grayscale correctly", () => {
  const gray = Float32Array.from([200, 100, 127, 128]);
  const mono = toMono(gray, 4, 1, { dither: false, threshold: 128 });
  assert.deepEqual(Array.from(mono), [0, 1, 1, 0]); // <128 = black(1)
});

test("packRows packs mono bits LSB-first", () => {
  // width 16, one row; black at x=0 and x=8
  const mono = new Uint8Array(16);
  mono[0] = 1;
  mono[8] = 1;
  const rows = packRows(mono, 16, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 0x01);
  assert.equal(rows[0][1], 0x01);
});

test("rgbaToRows: black pixel -> set bit, white -> clear", () => {
  // 8x1 RGBA: pixel0 black, others white
  const w = 8,
    h = 1;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255); // white, opaque
  rgba[0] = 0;
  rgba[1] = 0;
  rgba[2] = 0; // pixel 0 black
  const rows = rgbaToRows(rgba, w, h, { dither: false, threshold: 128 });
  assert.equal(rows[0][0] & 0x01, 0x01);
});
