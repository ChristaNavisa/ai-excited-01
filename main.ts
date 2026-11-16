// The Whale Over the City — ai-excited-01
//
// A self-contained vector illustration drawn entirely in code: a colossal
// whale breaches straight through a neon city skyline at dusk, backlit by
// a low burning sun, water exploding into glowing spray around it, while a
// tiny red paper plane flies past its eye. The caption at the bottom reads:
// "Some tides don't ask permission."
//
// The program runs on Node 22 standard library only, with nothing installed
// and no network: the scene is rasterised into a buffer by hand (a small
// software renderer: polygons, Bezier paths, gradients, a seeded layout)
// and written out as a PNG with zlib. The layout of the stars, the
// buildings, their windows, the sun's reflection and the spray comes from
// a seeded generator, so every run draws the same picture byte for byte.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------- picture size ----------
const W = 1024;
const H = 1024;
const SS = 2; // supersampling: draw at 2048, then halve for smooth edges
const W2 = W * SS;
const H2 = H * SS;

// ---------- small helpers ----------
type Pt = [number, number];
type RGBA = [number, number, number, number];
type Stop = [number, number, number, number, number]; // offset, r, g, b, alpha

function hex(rgb: string): [number, number, number] {
  const n = parseInt(rgb.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpStops(stops: Stop[], t: number): RGBA {
  if (t <= stops[0][0]) {
    const s = stops[0];
    return [s[1], s[2], s[3], s[4]];
  }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      return [
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f,
        a[4] + (b[4] - a[4]) * f,
      ];
    }
  }
  const s = stops[stops.length - 1];
  return [s[1], s[2], s[3], s[4]];
}

// ---------- seeded random numbers ----------
// A Mersenne Twister that matches CPython's random.Random: the same seeding
// (init_by_array) and the same 53-bit float construction, so the seeded
// layout below lands exactly where the reference picture has it.
class SeededRandom {
  private mt = new Uint32Array(624);
  private index = 624;

  constructor(seed: number) {
    this.mt[0] = 19650218;
    for (let i = 1; i < 624; i++) {
      this.mt[i] =
        (Math.imul(1812433253, this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i) >>> 0;
    }
    let i = 1;
    let j = 0;
    const key = [seed >>> 0];
    for (let k = 0; k < 624; k++) {
      const x = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = (this.mt[i] ^ Math.imul(x, 1664525)) + key[j] + j;
      this.mt[i] >>>= 0;
      i++;
      j++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = 0; k < 623; k++) {
      const x = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = (this.mt[i] ^ Math.imul(x, 1566083941)) - i;
      this.mt[i] >>>= 0;
      i++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
  }

  private twist(): void {
    for (let i = 0; i < 624; i++) {
      const y =
        (this.mt[i] & 0x80000000) | (this.mt[(i + 1) % 624] & 0x7fffffff);
      let v = this.mt[(i + 397) % 624] ^ (y >>> 1);
      if (y & 1) v ^= 0x9908b0df;
      this.mt[i] = v >>> 0;
    }
    this.index = 0;
  }

  int32(): number {
    if (this.index >= 624) this.twist();
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random(): number {
    const a = this.int32() >>> 5;
    const b = this.int32() >>> 6;
    return (a * 67108864.0 + b) / 9007199254740992.0;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }
}

// ---------- the canvas ----------
const buf = new Uint8ClampedArray(W2 * H2 * 4);
for (let i = 3; i < buf.length; i += 4) buf[i] = 255; // opaque canvas

type BlendFn = (
  t: Uint8ClampedArray,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
) => void;

// Source-over onto an opaque canvas.
function blendMain(
  t: Uint8ClampedArray,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const i = (y * W2 + x) * 4;
  if (a >= 1) {
    t[i] = r;
    t[i + 1] = g;
    t[i + 2] = b;
    return;
  }
  const ia = 1 - a;
  t[i] = r * a + t[i] * ia;
  t[i + 1] = g * a + t[i + 1] * ia;
  t[i + 2] = b * a + t[i + 2] * ia;
}

// Source-over onto a transparent layer, tracking its alpha.
function blendLayer(
  t: Uint8ClampedArray,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const i = (y * W2 + x) * 4;
  const da = t[i + 3] / 255;
  const out = a + da * (1 - a);
  if (out <= 0) {
    t[i + 3] = 0;
    return;
  }
  const ia = 1 - a;
  t[i] = (r * a + t[i] * da * ia) / out;
  t[i + 1] = (g * a + t[i + 1] * da * ia) / out;
  t[i + 2] = (b * a + t[i + 2] * da * ia) / out;
  t[i + 3] = out * 255;
}

// ---------- gradients ----------
// One RGBA entry per supersampled row, for a vertical gradient that runs
// from picture-space yStart to yEnd.
function makeVLUT(stops: Stop[], yStart: number, yEnd: number): Float32Array {
  const lut = new Float32Array(H2 * 4);
  for (let y = 0; y < H2; y++) {
    const t = (y / SS - yStart) / (yEnd - yStart);
    const c = lerpStops(stops, t);
    lut[y * 4] = c[0];
    lut[y * 4 + 1] = c[1];
    lut[y * 4 + 2] = c[2];
    lut[y * 4 + 3] = c[3];
  }
  return lut;
}

// ---------- rectangles, circles, discs ----------
function fillRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  a: number,
  t: Uint8ClampedArray = buf,
  blend: BlendFn = blendMain,
): void {
  const ax0 = Math.max(0, Math.floor(x0 * SS));
  const ax1 = Math.min(W2, Math.ceil(x1 * SS));
  const ay0 = Math.max(0, Math.floor(y0 * SS));
  const ay1 = Math.min(H2, Math.ceil(y1 * SS));
  for (let y = ay0; y < ay1; y++) {
    for (let x = ax0; x < ax1; x++) blend(t, x, y, r, g, b, a);
  }
}

function fillRectVGrad(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lut: Float32Array,
): void {
  const ax0 = Math.max(0, Math.floor(x0 * SS));
  const ax1 = Math.min(W2, Math.ceil(x1 * SS));
  const ay0 = Math.max(0, Math.floor(y0 * SS));
  const ay1 = Math.min(H2, Math.ceil(y1 * SS));
  for (let y = ay0; y < ay1; y++) {
    const li = y * 4;
    const r = lut[li];
    const g = lut[li + 1];
    const b = lut[li + 2];
    const a = lut[li + 3];
    let i = (y * W2 + ax0) * 4;
    for (let x = ax0; x < ax1; x++, i += 4) {
      if (a >= 1) {
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
      } else {
        const ia = 1 - a;
        buf[i] = r * a + buf[i] * ia;
        buf[i + 1] = g * a + buf[i + 1] * ia;
        buf[i + 2] = b * a + buf[i + 2] * ia;
      }
    }
  }
}

function fillCircle(
  cx: number,
  cy: number,
  rad: number,
  r: number,
  g: number,
  b: number,
  a: number,
  t: Uint8ClampedArray = buf,
  blend: BlendFn = blendMain,
): void {
  const cx2 = cx * SS;
  const cy2 = cy * SS;
  const r2 = rad * SS;
  const y0 = Math.max(0, Math.floor(cy2 - r2));
  const y1 = Math.min(H2 - 1, Math.ceil(cy2 + r2));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy2;
    const dx = Math.sqrt(Math.max(0, r2 * r2 - dy * dy));
    const x0 = Math.max(0, Math.ceil(cx2 - dx - 0.5));
    const x1 = Math.min(W2 - 1, Math.ceil(cx2 + dx - 0.5) - 1);
    for (let x = x0; x <= x1; x++) blend(t, x, y, r, g, b, a);
  }
}

function fillEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const cx2 = cx * SS;
  const cy2 = cy * SS;
  const rx2 = rx * SS;
  const ry2 = ry * SS;
  const y0 = Math.max(0, Math.floor(cy2 - ry2));
  const y1 = Math.min(H2 - 1, Math.ceil(cy2 + ry2));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy2) / ry2;
    const dx = rx2 * Math.sqrt(Math.max(0, 1 - dy * dy));
    const x0 = Math.max(0, Math.ceil(cx2 - dx - 0.5));
    const x1 = Math.min(W2 - 1, Math.ceil(cx2 + dx - 0.5) - 1);
    for (let x = x0; x <= x1; x++) blendMain(buf, x, y, r, g, b, a);
  }
}

// A disc painted with a radial gradient: t runs 0 at the centre to 1 at
// the rim, so a gradient that fades to transparent reads as a soft glow.
function radialDisc(
  cx: number,
  cy: number,
  rad: number,
  stops: Stop[],
): void {
  const cx2 = cx * SS;
  const cy2 = cy * SS;
  const r2 = rad * SS;
  const y0 = Math.max(0, Math.floor(cy2 - r2));
  const y1 = Math.min(H2 - 1, Math.ceil(cy2 + r2));
  const x0 = Math.max(0, Math.floor(cx2 - r2));
  const x1 = Math.min(W2 - 1, Math.ceil(cx2 + r2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx2;
      const dy = y + 0.5 - cy2;
      const d = Math.sqrt(dx * dx + dy * dy) / r2;
      if (d > 1) continue;
      const c = lerpStops(stops, d);
      if (c[3] > 0) blendMain(buf, x, y, c[0], c[1], c[2], c[3]);
    }
  }
}

// ---------- paths ----------
// Flatten a cubic Bezier into a polyline by repeated halving until the
// control points sit close enough to the chord.
function flattenCubic(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  tol: number,
  out: Pt[],
): void {
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / len;
  const d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / len;
  if (Math.max(d1, d2) <= tol) {
    out.push(p3);
    return;
  }
  const m01: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m23: Pt = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const m012: Pt = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  const m123: Pt = [(m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2];
  const m: Pt = [(m012[0] + m123[0]) / 2, (m012[1] + m123[1]) / 2];
  flattenCubic(p0, m01, m012, m, tol, out);
  flattenCubic(m, m123, m23, p3, tol, out);
}

function flattenQuad(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  tol: number,
  out: Pt[],
): void {
  const dx = p2[0] - p0[0];
  const dy = p2[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / len;
  if (d <= tol) {
    out.push(p2);
    return;
  }
  const m01: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m: Pt = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  flattenQuad(p0, m01, m, tol, out);
  flattenQuad(m, m12, p2, tol, out);
}

// Parse a small path language (M, L, C, Q, relative q, Z) into flattened
// polylines, one per subpath.
function parsePath(d: string): Pt[][] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths: Pt[][] = [];
  let pts: Pt[] = [];
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const num = (): number => parseFloat(tokens[i++]);
  const flush = (): void => {
    if (pts.length > 0) subpaths.push(pts);
    pts = [];
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (pts.length > 0) pts.push([sx, sy]);
        flush();
      }
      continue;
    }
    if (cmd === 'M') {
      if (pts.length > 0) flush();
      cx = num();
      cy = num();
      sx = cx;
      sy = cy;
      pts.push([cx, cy]);
      cmd = 'L';
    } else if (cmd === 'L') {
      cx = num();
      cy = num();
      pts.push([cx, cy]);
    } else if (cmd === 'C') {
      const p1: Pt = [num(), num()];
      const p2: Pt = [num(), num()];
      const p3: Pt = [num(), num()];
      flattenCubic([cx, cy], p1, p2, p3, 0.35, pts);
      cx = p3[0];
      cy = p3[1];
    } else if (cmd === 'Q') {
      const p1: Pt = [num(), num()];
      const p2: Pt = [num(), num()];
      flattenQuad([cx, cy], p1, p2, 0.35, pts);
      cx = p2[0];
      cy = p2[1];
    } else if (cmd === 'q') {
      const p1: Pt = [cx + num(), cy + num()];
      const p2: Pt = [cx + num(), cy + num()];
      flattenQuad([cx, cy], p1, p2, 0.35, pts);
      cx = p2[0];
      cy = p2[1];
    } else {
      i++;
    }
  }
  flush();
  return subpaths;
}

type PaintFn = (x: number, y: number) => RGBA;

function solidPaint(r: number, g: number, b: number, a: number): PaintFn {
  return () => [r, g, b, a];
}

// A gradient that runs diagonally across a shape's own bounding box,
// top-left to bottom-right.
function diagonalPaint(pts: Pt[], stops: Stop[]): PaintFn {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const den = bw * bw + bh * bh || 1;
  return (x, y) => {
    const px = x / SS - minX;
    const py = y / SS - minY;
    const t = (px * bw + py * bh) / den;
    return lerpStops(stops, Math.min(1, Math.max(0, t)));
  };
}

// A gradient that runs top to bottom across a shape's own bounding box.
function verticalPaint(pts: Pt[], stops: Stop[]): PaintFn {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = maxY - minY || 1;
  return (x, y) => lerpStops(stops, (y / SS - minY) / span);
}

// Scanline fill of a closed polygon (even-odd), painted per pixel.
function fillPoly(
  pts: Pt[],
  paint: PaintFn,
  t: Uint8ClampedArray,
  blend: BlendFn,
): void {
  const p2 = pts.map(([x, y]) => [x * SS, y * SS] as Pt);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of p2) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H2 - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < p2.length; i++) {
      const [ax, ay] = p2[i];
      const [bx, by] = p2[(i + 1) % p2.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(W2 - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = x0; x <= x1; x++) {
        const c = paint(x, y);
        if (c[3] > 0) blend(t, x, y, c[0], c[1], c[2], c[3]);
      }
    }
  }
}

// A polyline stroke with round caps and joins: a quad per segment plus a
// disc at every vertex.
function strokePoly(
  pts: Pt[],
  width: number,
  r: number,
  g: number,
  b: number,
  a: number,
  t: Uint8ClampedArray = buf,
  blend: BlendFn = blendMain,
): void {
  const half = width / 2;
  const paint = solidPaint(r, g, b, a);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    fillPoly(
      [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ],
      paint,
      t,
      blend,
    );
    fillCircle(ax, ay, half, r, g, b, a, t, blend);
  }
  const last = pts[pts.length - 1];
  fillCircle(last[0], last[1], half, r, g, b, a, t, blend);
}

// Dots spaced along a path, for the paper plane's dotted trail.
function dottedTrail(
  pts: Pt[],
  spacing: number,
  dotR: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  let dist = 0;
  let next = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const seg = Math.hypot(bx - ax, by - ay);
    let d = next - dist;
    while (d <= seg) {
      const f = d / seg;
      fillCircle(ax + (bx - ax) * f, ay + (by - ay) * f, dotR, r, g, b, a);
      next += spacing;
      d = next - dist;
    }
    dist += seg;
  }
}

// Composite a transparent layer onto the canvas, but only where a clip
// polygon covers it — the whale's pale belly, stripes and fin stay inside
// the body's outline this way.
function maskComposite(layer: Uint8ClampedArray, clipPts: Pt[]): void {
  const p2 = clipPts.map(([x, y]) => [x * SS, y * SS] as Pt);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of p2) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H2 - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < p2.length; i++) {
      const [ax, ay] = p2[i];
      const [bx, by] = p2[(i + 1) % p2.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(W2 - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = x0; x <= x1; x++) {
        const li = (y * W2 + x) * 4;
        const la = layer[li + 3] / 255;
        if (la > 0) {
          blendMain(buf, x, y, layer[li], layer[li + 1], layer[li + 2], la);
        }
      }
    }
  }
}

// ---------- a tiny 5x7 pixel font for the caption ----------
// Each glyph is 7 rows of 5 cells. Only the letters the caption needs.
const FONT: Record<string, string[]> = {
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  o: ['     ', ' ### ', '#   #', '#   #', '#   #', '#   #', ' ### '],
  m: ['     ', '     ', '#   #', '## ##', '# # #', '#   #', '#   #'],
  e: ['     ', ' ### ', '#   #', '#    ', '#### ', '#    ', ' ### '],
  t: ['  #  ', '  #  ', ' ### ', '  #  ', '  #  ', '  #  ', '  ## '],
  i: ['     ', '  #  ', '     ', '  #  ', '  #  ', '  #  ', ' ### '],
  d: ['    #', '    #', ' ### ', '#   #', '#   #', '#   #', ' ### '],
  s: ['     ', ' ### ', '#    ', ' ### ', '    #', '#    ', ' ### '],
  n: ['     ', '     ', '#### ', '#   #', '#   #', '#   #', '#   #'],
  a: ['     ', '     ', ' ### ', '    #', ' ####', '#   #', ' ### '],
  k: ['     ', '#    ', '#  # ', '# #  ', '##   ', '# #  ', '#  # '],
  p: ['     ', '     ', '#### ', '#   #', '#### ', '#    ', '#    '],
  r: ['     ', '     ', '## # ', '#  # ', '#    ', '#    ', '#    '],
  "'": ['  #  ', '  #  ', '  #  ', '     ', '     ', '     ', '     '],
  '.': ['     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
};

function drawText(
  text: string,
  cx: number,
  baselineY: number,
  cell: number,
  tracking: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const w = text.length * cell * 5 + (text.length - 1) * tracking;
  let x = cx - w / 2;
  const top = baselineY - cell * 7;
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '#') {
          fillRect(
            x + col * cell,
            top + row * cell,
            x + (col + 1) * cell,
            top + (row + 1) * cell,
            r,
            g,
            b,
            a,
          );
        }
      }
    }
    x += cell * 5 + tracking;
  }
}

// ---------- the scene's colours ----------
const SKY_STOPS: Stop[] = [
  [0, 0x15, 0x0b, 0x38, 1],
  [0.38, 0x4b, 0x1d, 0x5e, 1],
  [0.62, 0xa9, 0x2e, 0x63, 1],
  [0.78, 0xff, 0x7a, 0x3d, 1],
  [1, 0xff, 0xb3, 0x47, 1],
];
const SUN_STOPS: Stop[] = [
  [0, 0xff, 0xf8, 0xd0, 1],
  [0.45, 0xff, 0xd1, 0x66, 1],
  [0.8, 0xff, 0x8a, 0x3d, 1],
  [1, 0xff, 0x8a, 0x3d, 0],
];
const SEA_STOPS: Stop[] = [
  [0, 0x12, 0x26, 0x4f, 1],
  [1, 0x05, 0x0a, 0x1c, 1],
];
const WHALE_BACK: Stop[] = [
  [0, 0x2c, 0x4a, 0x7d, 1],
  [0.55, 0x1b, 0x2f, 0x5c, 1],
  [1, 0x0e, 0x1a, 0x38, 1],
];
const WHALE_BELLY: Stop[] = [
  [0, 0xe8, 0xf1, 0xfb, 1],
  [1, 0xa9, 0xc2, 0xe0, 1],
];

// ---------- the whale's outlines ----------
// The body arcs up from the splash at the bottom to the head at the top,
// the flukes spread where the tail meets the water, and the pale belly
// runs along the body's lower edge.
const BODY =
  'M 655 140 ' +
  'C 720 130, 765 175, 760 235 ' +
  'C 755 300, 725 400, 690 500 ' +
  'C 660 590, 625 680, 585 755 ' +
  'C 570 785, 555 800, 540 810 ' +
  'C 500 830, 460 835, 440 820 ' +
  'C 430 740, 445 640, 480 540 ' +
  'C 515 445, 560 335, 610 240 ' +
  'C 625 205, 635 170, 655 140 Z';
const FLUKES =
  'M 500 800 ' +
  'C 460 830, 430 850, 410 868 ' +
  'C 440 880, 480 885, 510 872 ' +
  'C 530 862, 550 858, 565 862 ' +
  'C 600 880, 650 882, 690 868 ' +
  'C 660 850, 620 825, 580 805 ' +
  'C 555 795, 525 792, 500 800 Z';
const BELLY =
  'M 455 800 ' +
  'C 445 720, 460 620, 495 520 ' +
  'C 525 435, 565 340, 610 250 ' +
  'C 625 220, 640 195, 655 175 ' +
  'C 665 210, 660 280, 640 350 ' +
  'C 615 440, 585 540, 555 640 ' +
  'C 530 720, 505 775, 480 815 ' +
  'C 468 812, 460 806, 455 800 Z';
const RIM =
  'M 700 145 C 750 170, 768 210, 760 260 ' +
  'C 750 340, 720 440, 688 520 C 665 590, 640 660, 605 730';
const FIN = 'M 610 500 C 570 545, 530 585, 505 630 C 550 635, 595 605, 620 550 Z';
const MOUTH = 'M 640 258 Q 695 275 742 232';
const TRAIL = 'M 830 302 C 740 322, 660 300, 600 326';

// Belly stripes, spray arcs and birds: path plus the strength to draw it.
const STRIPES: [string, number][] = [
  ['M 490 540 Q 550 565 590 520', 0.5],
  ['M 482 590 Q 542 615 582 570', 0.45],
  ['M 478 640 Q 538 665 576 620', 0.4],
];
const SPRAY: [string, number][] = [
  ['M 360 835 Q 430 730 480 650', 0.45],
  ['M 640 845 Q 660 740 645 620', 0.4],
];
const BIRDS: [string, number][] = [
  ['M 180 220 q 9 -9 18 0 q 9 -9 18 0', 3.5],
  ['M 250 180 q 7 -7 14 0 q 7 -7 14 0', 3],
  ['M 850 180 q 8 -8 16 0 q 8 -8 16 0', 3],
];
// The paper plane: a bright red dart with a darker folded underside.
const PLANE_A: Pt[] = [
  [830, 282],
  [880, 302],
  [830, 322],
  [843, 302],
];
const PLANE_B: Pt[] = [
  [830, 282],
  [843, 302],
  [830, 322],
];

// ---------- the seeded layout ----------
// One generator drives the whole scattered layout. The order matters: the
// skylines are laid out first, then the stars, then the sun's reflection
// on the water, and finally the spray droplets. Keep that order, or the
// buildings land in different places.
const rng = new SeededRandom(20261116);

interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface LitWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  col: [number, number, number];
}
interface Antenna {
  x: number;
  yTop: number;
}
function skyline(
  yBase: number,
  hmin: number,
  hmax: number,
  wmin: number,
  wmax: number,
  windows: boolean,
): { rects: Building[]; wins: LitWindow[]; ants: Antenna[] } {
  const rects: Building[] = [];
  const wins: LitWindow[] = [];
  const ants: Antenna[] = [];
  let x = -10;
  while (x < 1024) {
    const w = rng.uniform(wmin, wmax);
    const h = rng.uniform(hmin, hmax);
    rects.push({ x, y: yBase - h, w, h });
    if (windows) {
      const cols = Math.floor(w / 22);
      const rows = Math.floor(h / 30);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rng.random() < 0.5) {
            const col =
              rng.random() < 0.7 ? hex('#ffd166') : hex('#8fe3ff');
            wins.push({ x: x + 8 + c * 22, y: yBase - h + 12 + r * 30, w: 7, h: 10, col });
          }
        }
      }
    }
    x += w + rng.uniform(2, 14);
  }
  for (const rc of rects) {
    if (rc.h > hmax * 0.85) ants.push({ x: rc.x + rc.w / 2, yTop: rc.y });
  }
  return { rects, wins, ants };
}
const far = skyline(760, 70, 190, 50, 110, false);
const near = skyline(760, 60, 250, 55, 120, true);

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
}
const stars: Star[] = [];
for (let i = 0; i < 70; i++) {
  stars.push({
    x: rng.uniform(0, 1024),
    y: rng.uniform(0, 380),
    r: rng.uniform(0.8, 2.4),
    o: rng.uniform(0.35, 0.95),
  });
}

interface Streak {
  x: number;
  y: number;
  w: number;
  o: number;
}
const streaks: Streak[] = [];
{
  let y = 778;
  while (y < 1000) {
    const cx = 700 + rng.uniform(-25, 25);
    const w = rng.uniform(40, 150) * (1 - (y - 778) / 260) + 25;
    streaks.push({ x: cx - w / 2, y, w, o: rng.uniform(0.15, 0.45) });
    y += rng.uniform(12, 20);
  }
}

interface Drop {
  x: number;
  y: number;
  r: number;
  col: [number, number, number];
  o: number;
}
const drops: Drop[] = [];
for (let i = 0; i < 46; i++) {
  const t = rng.random();
  const x = 500 + rng.uniform(-170, 170) * (1 - t * 0.3);
  const y = 800 - t * rng.uniform(50, 300);
  const r = rng.uniform(2, 9) * (1 - t * 0.4);
  const col = rng.random() < 0.75 ? hex('#eaf6ff') : hex('#9fdcff');
  drops.push({ x, y, r, col, o: rng.uniform(0.45, 0.95) });
}

// ---------- draw the scene, back to front ----------
function render(): void {
  // Dusk sky, deep purple at the top burning down to amber at the horizon.
  fillRectVGrad(0, 0, W, H, makeVLUT(SKY_STOPS, 0, H));

  // Stars, only in the upper sky.
  for (const s of stars) {
    fillCircle(s.x, s.y, s.r, 255, 255, 255, s.o);
  }

  // The low sun: a wide soft halo, then its bright core.
  radialDisc(700, 545, 200, SUN_STOPS);
  radialDisc(700, 545, 102, SUN_STOPS);

  // The far skyline, a flat purple silhouette with a few aerials.
  const farCol = hex('#4a2d6e');
  for (const b of far.rects) {
    fillRect(b.x, b.y, b.x + b.w, b.y + b.h, farCol[0], farCol[1], farCol[2], 1);
  }
  for (const an of far.ants) {
    strokePoly(
      [
        [an.x, an.yTop],
        [an.x, an.yTop - 26],
      ],
      3,
      farCol[0],
      farCol[1],
      farCol[2],
      1,
    );
    fillCircle(an.x, an.yTop - 28, 3, 0xff, 0x5a, 0x4e, 1);
  }

  // The near skyline, nearly black, its windows lit gold and ice-blue.
  const nearCol = hex('#150e2e');
  for (const b of near.rects) {
    fillRect(b.x, b.y, b.x + b.w, b.y + b.h, nearCol[0], nearCol[1], nearCol[2], 1);
  }
  for (const w of near.wins) {
    fillRect(w.x, w.y, w.x + w.w, w.y + w.h, w.col[0], w.col[1], w.col[2], 0.9);
  }
  for (const an of near.ants) {
    strokePoly(
      [
        [an.x, an.yTop],
        [an.x, an.yTop - 26],
      ],
      3,
      nearCol[0],
      nearCol[1],
      nearCol[2],
      1,
    );
    fillCircle(an.x, an.yTop - 28, 3, 0xff, 0x5a, 0x4e, 1);
  }

  // The sea, dark navy deepening toward the bottom of the frame.
  fillRectVGrad(0, 760, W, H, makeVLUT(SEA_STOPS, 760, H));

  // The sun's reflection, broken into short amber streaks that fade as
  // they run down the water.
  for (const s of streaks) {
    fillRect(s.x, s.y, s.x + s.w, s.y + 4, 0xff, 0xb3, 0x47, s.o);
  }

  // The white ring of churned water where the whale leaves the sea.
  fillEllipse(470, 798, 170, 24, 0xdf, 0xf1, 0xff, 0.28);
  fillEllipse(470, 812, 120, 18, 255, 255, 255, 0.3);

  // The paper plane's dotted trail, curving in from the right.
  dottedTrail(parsePath(TRAIL)[0], 11, 1.5, 255, 255, 255, 0.5);

  // The whale: tail flukes first, then the body, both in a deep blue
  // gradient that runs from the head down to the tail.
  const bodyPts = parsePath(BODY)[0];
  const flukePts = parsePath(FLUKES)[0];
  fillPoly(flukePts, diagonalPaint(flukePts, WHALE_BACK), buf, blendMain);
  fillPoly(bodyPts, diagonalPaint(bodyPts, WHALE_BACK), buf, blendMain);

  // The pale belly, its curved stripes and the dark fin, drawn on their
  // own layer and clipped to the body's outline.
  const layer = new Uint8ClampedArray(W2 * H2 * 4);
  const bellyPts = parsePath(BELLY)[0];
  fillPoly(bellyPts, verticalPaint(bellyPts, WHALE_BELLY), layer, blendLayer);
  for (const [d, op] of STRIPES) {
    strokePoly(parsePath(d)[0], 4, 0x7d, 0x9c, 0xc9, op, layer, blendLayer);
  }
  fillPoly(parsePath(FIN)[0], solidPaint(0x16, 0x26, 0x4d, 1), layer, blendLayer);
  maskComposite(layer, bodyPts);

  // A warm rim of light along the whale's sunlit edge, its smiling mouth,
  // and one watchful eye with a glint in it.
  strokePoly(parsePath(RIM)[0], 6, 0xff, 0xb3, 0x47, 0.5);
  strokePoly(parsePath(MOUTH)[0], 5, 0x0a, 0x12, 0x26, 0.75);
  fillCircle(688, 208, 11, 0x0a, 0x0f, 0x1e, 1);
  fillCircle(692, 204, 3.5, 255, 255, 255, 1);

  // Two arcs of spray thrown off the breach, and the droplets scattered
  // around them.
  for (const [d, op] of SPRAY) {
    strokePoly(parsePath(d)[0], 5, 0xea, 0xf6, 0xff, op);
  }
  for (const d of drops) {
    fillCircle(d.x, d.y, d.r, d.col[0], d.col[1], d.col[2], d.o);
  }

  // The tiny red paper plane, the only thing flying higher than the whale.
  fillPoly(PLANE_A, solidPaint(0xff, 0x45, 0x3a, 1), buf, blendMain);
  fillPoly(PLANE_B, solidPaint(0xc8, 0x1e, 0x1e, 1), buf, blendMain);

  // Three distant birds, small dark chevrons in the upper sky.
  for (const [d, w] of BIRDS) {
    strokePoly(parsePath(d)[0], w, 0x1c, 0x10, 0x30, 1);
  }

  // The caption, centred near the bottom.
  drawText("Some tides don't ask permission.", 512, 972, 5, 5, 255, 255, 255, 0.92);
}

// ---------- PNG output ----------
// Halve the supersampled canvas back to 1024x1024.
function downsample(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const oi = (y * W + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * W2 + (x * SS + dx)) * 4;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          a += buf[i + 3];
        }
      }
      out[oi] = Math.round(r / 4);
      out[oi + 1] = Math.round(g / 4);
      out[oi + 2] = Math.round(b / 4);
      out[oi + 3] = Math.round(a / 4);
    }
  }
  return out;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
  out.writeUInt32BE(crc >>> 0, 8 + data.length);
  return out;
}

// Filter one scanline: 0 none, 1 Sub, 2 Up.
function filterRow(row: Buffer, type: number, prev: Buffer | null): Buffer {
  const out = Buffer.alloc(row.length + 1);
  out[0] = type;
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    let p = 0;
    if (type === 1) p = i >= 4 ? row[i - 4] : 0;
    else if (type === 2) p = prev ? prev[i] : 0;
    out[i + 1] = (v - p) & 0xff;
  }
  return out;
}

// The sum of absolute residual values, the usual way to pick a filter.
function filterScore(b: Buffer): number {
  let s = 0;
  for (let i = 1; i < b.length; i++) {
    const v = b[i];
    s += v < 128 ? v : 256 - v;
  }
  return s;
}

function encodePNG(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const stride = w * 4;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.from(rgba.subarray(y * stride, (y + 1) * stride));
    const prev =
      y === 0 ? null : Buffer.from(rgba.subarray((y - 1) * stride, y * stride));
    const cands = [
      filterRow(row, 0, prev),
      filterRow(row, 1, prev),
      filterRow(row, 2, prev),
    ];
    let best = cands[0];
    let bestScore = filterScore(cands[0]);
    for (let k = 1; k < cands.length; k++) {
      const s = filterScore(cands[k]);
      if (s < bestScore) {
        best = cands[k];
        bestScore = s;
      }
    }
    rows.push(best);
  }
  const raw = Buffer.concat(rows);
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- run ----------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
render();
writeFileSync(join(outDir, 'entry.png'), encodePNG(downsample(), W, H));
