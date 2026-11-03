// Convert generated PNG variants into platform containers. Keep large image payloads byte-for-byte.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root = process.cwd();
const icons = path.join(root, "src-tauri/icons");
const small = path.join(root, "assets/icons-small");
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
const png = (size) => fs.readFileSync(path.join(small, `${size}x${size}.png`));
const icoPath = path.join(icons, "icon.ico");
const ico = fs.readFileSync(icoPath);
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1)
  throw Error("Invalid ICO");
const large = [];
for (let i = 0; i < ico.readUInt16LE(4); i++) {
  const entry = Buffer.from(ico.subarray(6 + i * 16, 22 + i * 16));
  const size = entry[0] || 256;
  if (size <= 32) continue;
  const start = entry.readUInt32LE(12);
  const data = ico.subarray(start, start + entry.readUInt32LE(8));
  large.push({ size, entry, data, hash: hash(data) });
}
const entries = [16, 20, 24, 32]
  .map((size) => {
    const data = png(size),
      entry = Buffer.alloc(16);
    entry[0] = size;
    entry[1] = size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    return { size, entry, data };
  })
  .concat(large);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = 6 + entries.length * 16;
for (const entry of entries) {
  entry.entry.writeUInt32LE(offset, 12);
  offset += entry.data.length;
}
fs.writeFileSync(
  icoPath,
  Buffer.concat([
    header,
    ...entries.map((e) => e.entry),
    ...entries.map((e) => e.data),
  ]),
);

const icnsPath = path.join(icons, "icon.icns");
const icns = fs.readFileSync(icnsPath);
if (icns.toString("ascii", 0, 4) !== "icns") throw Error("Invalid ICNS");
const chunks = [],
  retained = [],
  seen = new Set();
for (let offset = 8; offset < icns.length;) {
  const type = icns.toString("ascii", offset, offset + 4);
  const length = icns.readUInt32BE(offset + 4);
  if (length < 8 || offset + length > icns.length)
    throw Error("Invalid ICNS chunk");
  if (["il32", "l8mk", "is32", "s8mk"].includes(type)) {
    offset += length;
    continue;
  }
  seen.add(type);
  const size = { icp4: 16, icp5: 32, ic11: 32 }[type];
  if (size) {
    const data = png(size),
      header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    chunks.push(Buffer.concat([header, data]));
  } else {
    const data = icns.subarray(offset, offset + length);
    chunks.push(data);
    retained.push({ type, hash: hash(data) });
  }
  offset += length;
}
for (const [type, size] of [
  ["icp4", 16],
  ["icp5", 32],
  ["ic11", 32],
]) {
  if (seen.has(type)) continue;
  const data = png(size),
    header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  chunks.push(Buffer.concat([header, data]));
}
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(
  8 + chunks.reduce((n, chunk) => n + chunk.length, 0),
  4,
);
fs.writeFileSync(icnsPath, Buffer.concat([icnsHeader, ...chunks]));
for (const size of [16, 20, 24, 32])
  fs.copyFileSync(
    path.join(small, `${size}x${size}.png`),
    path.join(icons, `${size}x${size}.png`),
  );
fs.mkdirSync(".qa", { recursive: true });
fs.writeFileSync(
  ".qa/small-icons-containers.json",
  JSON.stringify(
    {
      icoLargeRetained: large.map(({ size, hash }) => ({ size, hash })),
      icnsChunksRetained: retained,
    },
    null,
    2,
  ),
);
process.stdout.write(
  "Small icon variants synced; large ICO/ICNS image payloads retained.\n",
);
