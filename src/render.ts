/**
 * Canvas-based rendering (browser). Produces packed printer rows (48 bytes
 * each) from text, images, or any CanvasImageSource, scaled to 384 px wide.
 */
import { PRINT_WIDTH } from "./protocol";
import { rgbaToRows, type DitherOptions } from "./image";

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCtx(width: number, height: number): AnyCtx {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    return ctx as AnyCtx;
  }
  if (typeof document === "undefined") {
    throw new Error("Rendering requires a browser (Canvas). Use image.ts helpers in Node.");
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  return ctx;
}

export interface TextRenderOptions {
  fontSize?: number;
  fontFamily?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  margin?: number;
  lineHeight?: number;
}

function wrapText(ctx: AnyCtx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      out.push("");
      continue;
    }
    const words = para.split(" ");
    let cur = "";
    for (let w of words) {
      const trial = cur ? cur + " " + w : w;
      if (ctx.measureText(trial).width <= maxWidth) {
        cur = trial;
      } else {
        if (cur) out.push(cur);
        // hard-break a single overly long word
        while (ctx.measureText(w).width > maxWidth && w.length > 1) {
          let cut = w.length;
          while (cut > 1 && ctx.measureText(w.slice(0, cut)).width > maxWidth) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        cur = w;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Render wrapped text to crisp (thresholded) printer rows. */
export function textToRows(text: string, opts: TextRenderOptions = {}): Uint8Array[] {
  const fontSize = opts.fontSize ?? 28;
  const family = opts.fontFamily ?? "sans-serif";
  const weight = opts.bold ? "bold " : "";
  const margin = opts.margin ?? 4;
  const font = `${weight}${fontSize}px ${family}`;
  const lineH = opts.lineHeight ?? Math.ceil(fontSize * 1.35);

  const measure = makeCtx(PRINT_WIDTH, 10);
  measure.font = font;
  const lines = wrapText(measure, text, PRINT_WIDTH - 2 * margin);
  const height = Math.max(lineH + 2 * margin, lines.length * lineH + 2 * margin);

  const ctx = makeCtx(PRINT_WIDTH, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PRINT_WIDTH, height);
  ctx.fillStyle = "#000";
  ctx.font = font;
  ctx.textBaseline = "top";

  let y = margin;
  for (const ln of lines) {
    const w = ctx.measureText(ln).width;
    let x = margin;
    if (opts.align === "center") x = (PRINT_WIDTH - w) / 2;
    else if (opts.align === "right") x = PRINT_WIDTH - margin - w;
    ctx.fillText(ln, x, y);
    y += lineH;
  }
  const img = ctx.getImageData(0, 0, PRINT_WIDTH, height);
  return rgbaToRows(img.data, img.width, img.height, { dither: false, threshold: 128 });
}

/** Render any drawable (image, canvas, bitmap, video frame) scaled to 384 wide. */
export function drawableToRows(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  opts: DitherOptions = {},
): Uint8Array[] {
  const height = Math.max(1, Math.round((sourceHeight * PRINT_WIDTH) / sourceWidth));
  const ctx = makeCtx(PRINT_WIDTH, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PRINT_WIDTH, height);
  ctx.drawImage(source, 0, 0, PRINT_WIDTH, height);
  const img = ctx.getImageData(0, 0, PRINT_WIDTH, height);
  return rgbaToRows(img.data, img.width, img.height, opts);
}

/** Render an HTMLImageElement (uses its natural size). */
export function imageElementToRows(
  el: HTMLImageElement,
  opts: DitherOptions = {},
): Uint8Array[] {
  return drawableToRows(el, el.naturalWidth || el.width, el.naturalHeight || el.height, opts);
}

/** Convert an ImageData directly (no scaling) to rows. */
export function imageDataToRows(img: ImageData, opts: DitherOptions = {}): Uint8Array[] {
  return rgbaToRows(img.data, img.width, img.height, opts);
}
