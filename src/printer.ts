/**
 * CatPrinter — Web Bluetooth transport + high-level printing API.
 *
 * Browser only. `connect()` MUST be called from a user gesture (click/tap),
 * and the page must be a secure context (HTTPS or http://localhost).
 * Web Bluetooth is supported in Chromium browsers (Chrome/Edge/Opera).
 */
import * as proto from "./protocol";
import { buildJob, type JobOptions } from "./job";
import {
  textToRows,
  drawableToRows,
  imageElementToRows,
  imageDataToRows,
  type TextRenderOptions,
} from "./render";
import type { DitherOptions } from "./image";

export const SERVICE_AE30 = "0000ae30-0000-1000-8000-00805f9b34fb";
export const CHAR_AE01 = "0000ae01-0000-1000-8000-00805f9b34fb"; // write w/o response
export const CHAR_AE02 = "0000ae02-0000-1000-8000-00805f9b34fb"; // notify
export const CHAR_AE10 = "0000ae10-0000-1000-8000-00805f9b34fb"; // read/write

export interface PrinterOptions {
  /** Bytes per BLE write (default 128). */
  chunkSize?: number;
  /** Delay in ms between chunks (default 8). */
  delayMs?: number;
  onNotify?: (data: Uint8Array) => void;
  onLog?: (msg: string) => void;
  onDisconnect?: () => void;
}

export interface SendOptions {
  chunkSize?: number;
  delayMs?: number;
  onProgress?: (sent: number, total: number) => void;
}

export interface DeviceStatus {
  firmware: string | null;
  stateRaw: string | null;
  ae10Raw: string | null;
  notifications: string[];
  /**
   * Battery is NOT exposed by the classic 0xAE30 firmware (the state response
   * is constant and AE10 reads zeros). Present for forward-compat with models
   * that do report it; null when unavailable.
   */
  battery: number | null;
}

export type PrintOptions = JobOptions & DitherOptions & SendOptions;

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export class CatPrinter {
  device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private svc: BluetoothRemoteGATTService | null = null;
  private notes: Uint8Array[] = [];
  private readonly opts: Required<Pick<PrinterOptions, "chunkSize" | "delayMs">> & PrinterOptions;

  constructor(options: PrinterOptions = {}) {
    this.opts = { chunkSize: 128, delayMs: 8, ...options };
  }

  get connected(): boolean {
    return !!this.server?.connected;
  }

  private log(msg: string) {
    this.opts.onLog?.(msg);
  }

  /** Whether Web Bluetooth is usable in this environment. */
  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.bluetooth;
  }

  /**
   * Prompt the chooser and connect. Must be triggered by a user gesture.
   * By default shows all devices (this printer often does not advertise the
   * 0xAE30 service). Pass custom `requestOptions` to filter, e.g. by namePrefix.
   */
  async connect(requestOptions?: RequestDeviceOptions): Promise<void> {
    if (!CatPrinter.isSupported()) {
      throw new Error(
        "Web Bluetooth unavailable. Use Chrome/Edge over HTTPS or http://localhost.",
      );
    }
    const options: RequestDeviceOptions =
      requestOptions ?? { acceptAllDevices: true, optionalServices: [SERVICE_AE30] };
    this.device = await navigator.bluetooth.requestDevice(options);
    this.device.addEventListener("gattserverdisconnected", () => {
      this.log("disconnected");
      this.opts.onDisconnect?.();
      this.server = null;
      this.writeChar = null;
    });
    await this.reconnect();
  }

  /** (Re)establish the GATT connection to the already-selected device. */
  async reconnect(): Promise<void> {
    if (!this.device?.gatt) throw new Error("No device selected; call connect() first.");
    this.server = await this.device.gatt.connect();
    this.svc = await this.server.getPrimaryService(SERVICE_AE30);
    this.writeChar = await this.svc.getCharacteristic(CHAR_AE01);
    try {
      this.notifyChar = await this.svc.getCharacteristic(CHAR_AE02);
      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener("characteristicvaluechanged", (ev) => {
        const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value;
        if (!dv) return;
        const bytes = new Uint8Array(dv.buffer);
        this.notes.push(bytes);
        this.opts.onNotify?.(bytes);
        this.log(`notify: ${hex(bytes)}`);
      });
    } catch {
      this.log("notify characteristic unavailable");
    }
    this.log(`connected to ${this.device.name ?? "printer"}`);
  }

  async disconnect(): Promise<void> {
    try {
      this.server?.disconnect();
    } finally {
      this.server = null;
      this.writeChar = null;
    }
  }

  /** Stream a raw command byte-buffer to characteristic 0xAE01. */
  async sendRaw(bytes: Uint8Array, send: SendOptions = {}): Promise<void> {
    if (!this.writeChar) throw new Error("Not connected.");
    const chunkSize = send.chunkSize ?? this.opts.chunkSize;
    const delayMs = send.delayMs ?? this.opts.delayMs;
    const total = bytes.length;
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, total));
      await this.writeChar.writeValueWithoutResponse(chunk);
      send.onProgress?.(Math.min(i + chunkSize, total), total);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  /** Print pre-packed 48-byte rows. */
  async printRows(rows: Uint8Array[], opts: PrintOptions = {}): Promise<void> {
    await this.sendRaw(buildJob(rows, opts), opts);
  }

  async printText(text: string, opts: PrintOptions & TextRenderOptions = {}): Promise<void> {
    await this.printRows(textToRows(text, opts), opts);
  }

  async printImage(el: HTMLImageElement, opts: PrintOptions = {}): Promise<void> {
    await this.printRows(imageElementToRows(el, opts), opts);
  }

  async printDrawable(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    opts: PrintOptions = {},
  ): Promise<void> {
    await this.printRows(drawableToRows(source, sourceWidth, sourceHeight, opts), opts);
  }

  async printImageData(img: ImageData, opts: PrintOptions = {}): Promise<void> {
    await this.printRows(imageDataToRows(img, opts), opts);
  }

  /** Feed paper by N lines. */
  async feed(lines = 80): Promise<void> {
    await this.sendRaw(proto.feedPaper(lines));
  }

  /**
   * Query firmware / state. `battery` is null on models that don't report it
   * (the classic 0xAE30 firmware). Firmware is decoded reliably.
   */
  async getStatus(waitMs = 1300): Promise<DeviceStatus> {
    if (!this.writeChar) throw new Error("Not connected.");
    this.notes = [];
    await this.writeChar.writeValueWithoutResponse(proto.getDeviceInfo());
    await this.writeChar.writeValueWithoutResponse(proto.getDeviceState());
    await new Promise((r) => setTimeout(r, waitMs));

    let ae10Raw: string | null = null;
    try {
      const c = await this.svc?.getCharacteristic(CHAR_AE10);
      const v = await c?.readValue();
      if (v) ae10Raw = hex(new Uint8Array(v.buffer));
    } catch {
      /* not readable on all models */
    }

    const blob = new Uint8Array(this.notes.reduce((a, n) => a + n.length, 0));
    let off = 0;
    for (const n of this.notes) {
      blob.set(n, off);
      off += n.length;
    }
    const status: DeviceStatus = {
      firmware: null,
      stateRaw: null,
      ae10Raw,
      notifications: this.notes.map(hex),
      battery: null,
    };
    for (const { cmd, payload } of proto.parseFrames(blob)) {
      if (cmd === proto.Cmd.GetDevInfo) {
        const ascii = Array.from(payload)
          .filter((b) => b >= 32 && b < 127)
          .map((b) => String.fromCharCode(b))
          .join("")
          .trim();
        if (ascii) status.firmware = ascii;
      } else if (cmd === proto.Cmd.GetDevState) {
        status.stateRaw = hex(payload);
      }
    }
    return status;
  }
}
