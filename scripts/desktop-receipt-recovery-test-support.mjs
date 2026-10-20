import { deflateRawSync } from 'node:zlib';

// Minimal independent ZIP fixture, covering both supported compression methods.
export function archive(items) {
  const bodies = [];
  const directory = [];
  let offset = 0;
  for (const {
    name,
    text = '{}',
    method = 0,
    attributes = 0,
    size,
    localName = name,
    flags = 0,
  } of items) {
    const bytes = Buffer.from(text);
    const compressed = method === 8 ? deflateRawSync(bytes) : bytes;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(size ?? bytes.length, 22);
    header.writeUInt16LE(Buffer.byteLength(localName), 26);
    const body = Buffer.concat([header, Buffer.from(localName), compressed]);
    bodies.push(body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size ?? bytes.length, 24);
    central.writeUInt16LE(Buffer.byteLength(name), 28);
    central.writeUInt32LE(attributes, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(central, Buffer.from(name));
    offset += body.length;
  }
  const entries = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(entries.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, entries, end]);
}
