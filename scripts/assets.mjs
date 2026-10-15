import { mkdir, cp, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  await mkdir(`public/${dir}`, { recursive: true });
  await cp(`node_modules/pdfjs-dist/${dir}`, `public/${dir}`, {
    recursive: true,
  });
}
// Small original app icon, generated from pixels (no external artwork).
const n = 64,
  raw = Buffer.alloc(n * (n * 4 + 1));
for (let y = 0; y < n; y++)
  for (let x = 0; x < n; x++) {
    const i = y * (n * 4 + 1) + 1 + x * 4;
    const paper = x > 16 && x < 48 && y > 12 && y < 52;
    raw.set(paper ? [240, 245, 228, 255] : [53, 95, 73, 255], i);
  }
function crc(b) {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(t, b) {
  const data = Buffer.concat([Buffer.from(t), b]);
  const out = Buffer.alloc(b.length + 12);
  out.writeUInt32BE(b.length);
  data.copy(out, 4);
  out.writeUInt32BE(crc(data), out.length - 4);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(n);
ihdr.writeUInt32BE(n, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(1, 4);
head[6] = n;
head[7] = n;
head.writeUInt16LE(1, 10);
head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14);
head.writeUInt32LE(22, 18);
await mkdir("src-tauri/icons", { recursive: true });
await writeFile("src-tauri/icons/icon.ico", Buffer.concat([head, png]));
await writeFile("src-tauri/icons/icon.png", png);
