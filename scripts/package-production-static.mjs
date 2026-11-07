import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const root = process.cwd();
const source = path.join(root, "production-output");
assert.ok((await stat(source)).isDirectory(), "production-output must exist; run the preflight first");

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function walk(dir, prefix = "") {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const rel = prefix ? prefix + "/" + item.name : item.name;
    if (item.isDirectory()) out.push(...await walk(full, rel));
    else if (item.isFile()) out.push({ full, rel });
  }
  return out;
}
const files = (await walk(source)).sort((a,b) => a.rel.localeCompare(b.rel));
assert.ok(files.length >= 70, "bundle must contain the public HTML, assets, and catalog");
const localParts = [];
const centralParts = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(file.rel.replace(/\\/g, "/"), "utf8");
  const data = await readFile(file.full);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}
const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);
const zip = Buffer.concat([...localParts, centralDirectory, end]);
const zipPath = path.join(root, "production-release-bundle.zip");
await writeFile(zipPath, zip);
// Re-open the ZIP and verify each entry's sizes, CRC32 and bytes before publishing the artifact.
const check = await readFile(zipPath);
const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const eocdOffset = check.lastIndexOf(eocdSignature);
assert.ok(eocdOffset >= 0, "ZIP end-of-central-directory record must exist");
const entryCount = check.readUInt16LE(eocdOffset + 10);
const centralSize = check.readUInt32LE(eocdOffset + 12);
let centralOffset = check.readUInt32LE(eocdOffset + 16);
assert.equal(entryCount, files.length, "ZIP entry count must match source file count");
assert.ok(centralOffset + centralSize <= eocdOffset, "ZIP central directory bounds must be valid");
for (let i = 0; i < entryCount; i++) {
  assert.equal(check.readUInt32LE(centralOffset), 0x02014b50, "ZIP central directory signature");
  const crc = check.readUInt32LE(centralOffset + 16);
  const compressedSize = check.readUInt32LE(centralOffset + 20);
  const uncompressedSize = check.readUInt32LE(centralOffset + 24);
  const nameLength = check.readUInt16LE(centralOffset + 28);
  const extraLength = check.readUInt16LE(centralOffset + 30);
  const commentLength = check.readUInt16LE(centralOffset + 32);
  const localOffset = check.readUInt32LE(centralOffset + 42);
  const name = check.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");
  assert.equal(check.readUInt32LE(localOffset), 0x04034b50, "ZIP local file header signature");
  const localNameLength = check.readUInt16LE(localOffset + 26);
  const localExtraLength = check.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = check.subarray(dataOffset, dataOffset + compressedSize);
  const restored = inflateRawSync(compressed);
  assert.equal(restored.length, uncompressedSize, "ZIP uncompressed size: " + name);
  assert.equal(crc32(restored), crc, "ZIP CRC32: " + name);
  const original = await readFile(files.find(f => f.rel === name).full);
  assert.equal(Buffer.compare(restored, original), 0, "ZIP bytes match source: " + name);
  centralOffset += 46 + nameLength + extraLength + commentLength;
}
assert.equal(centralOffset, eocdOffset, "ZIP central directory must end at EOCD");

const digest = createHash("sha256").update(zip).digest("hex");
await writeFile(path.join(root, "production-release-bundle.sha256"), digest + "  production-release-bundle.zip\n");
console.log("PASS package: " + files.length + " files, " + zip.length + " bytes");
console.log("SHA-256: " + digest);
