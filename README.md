# thermorinter

A browser **SDK** for BLE "cat" thermal printers (the `0xAE30` protocol used by
GB01/GT01/YY and compatible models, e.g. `TD-11308`). Talk to the printer
directly from a web page over **Web Bluetooth** — no server, no native app.

The protocol was reverse-engineered and verified byte-for-byte against real
packet captures (CRC-8/0x07 framing, `0xA2` bitmap rows, lattice/energy).

## Features

- Connect over Web Bluetooth (`navigator.bluetooth`)
- Print **text** (Canvas-rendered, wrapped, font/size/alignment)
- Print **images** (any `<img>`, canvas, `ImageData`, or drawable) — auto-scaled
  to 384 px with **Floyd–Steinberg dithering**, threshold, and invert
- Print **pre-packed rows** or send **raw** command bytes
- **Feed paper**, adjustable **darkness** (energy), quality, speed
- Read **device status** (firmware is reliable; battery is not exposed by the
  classic firmware — see note below)
- Ships as **ESM + CJS + TypeScript types**; tree-shakeable, zero runtime deps

## Requirements

Web Bluetooth works in **Chromium browsers** (Chrome, Edge, Opera) on desktop
and Android. It is **not** available in Firefox or Safari.

Two hard browser rules:

1. **Secure context** — the page must be served over `https://` or
   `http://localhost`.
2. **User gesture** — `connect()` must be called from a click/tap handler.

## Install

```bash
npm install thermorinter
```

## Usage

```ts
import { CatPrinter } from "thermorinter";

const printer = new CatPrinter({ onLog: console.log });

// must be inside a click handler:
button.addEventListener("click", async () => {
  await printer.connect();                 // shows the device chooser
  await printer.printText("Hello!", { fontSize: 30, align: "center" });

  const img = document.querySelector("img")!;
  await printer.printImage(img, { dither: true, energy: 12000 });

  await printer.feed(60);
  console.log(await printer.getStatus());   // { firmware, stateRaw, battery, ... }
  await printer.disconnect();
});
```

### Printing sources

```ts
await printer.printText(text, { fontSize, fontFamily, align, bold, ...jobOpts });
await printer.printImage(htmlImageElement, { dither, invert, threshold, ...jobOpts });
await printer.printDrawable(canvas, canvas.width, canvas.height, opts);
await printer.printImageData(ctx.getImageData(...), opts);
await printer.printRows(rows /* Uint8Array[] of 48 bytes */, opts);
await printer.sendRaw(bytes /* Uint8Array */);
```

`jobOpts`: `{ energy?: 0..65535, feedLines?: number, quality?: number }`.
`onProgress?: (sent, total) => void` is available on all print calls.

### Low-level protocol (no BLE, no DOM)

Everything used to build a job is exported and pure:

```ts
import { crc8, command, encodeRow, buildJob, rgbaToRows, Cmd } from "thermorinter";
```

## Device chooser & this printer

Many of these printers do **not** advertise the `0xAE30` service, so filtering
by it can hide them. By default `connect()` uses `acceptAllDevices` plus
`optionalServices: [0xAE30]` and lets the user pick. To filter yourself:

```ts
await printer.connect({ filters: [{ namePrefix: "TD-" }], optionalServices: ["0000ae30-0000-1000-8000-00805f9b34fb"] });
```

## Battery status

The classic `0xAE30` firmware does **not** expose battery or temperature: the
`GetDevState` response is constant regardless of charge or printing, and the
`0xAE10` characteristic reads as zeros. `getStatus()` therefore returns
`battery: null` and only decodes **firmware** reliably. The plumbing is in place
for newer models (e.g. MXW01) that do report battery.

## Develop

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run build        # dist/ (esm, cjs, d.ts) via tsup
npm test             # build + node --test (protocol/image unit tests)
npm run serve:demo   # http://localhost:8000/examples/  (localhost is a secure context)
```

## License

MIT
