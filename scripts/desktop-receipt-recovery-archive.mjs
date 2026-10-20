import { inflateRawSync } from 'node:zlib';
import { requireRecovery } from './desktop-receipt-recovery.mjs';

// Read selected bounded ZIP members as data. Never extract paths, launch an installer
// or import code from a retained artifact. The complete archive digest is checked first.
export function readRecoveryArchive(bytes) {
  requireRecovery(
    Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= 600_000_000,
    'invalid archive size',
  );
  let end = bytes.length - 22;
  const minimum = Math.max(0, end - 65_535);
  while (end >= minimum && bytes.readUInt32LE(end) !== 0x06054b50) end -= 1;
  requireRecovery(
    end >= minimum &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length &&
      bytes.readUInt16LE(end + 4) === 0 &&
      bytes.readUInt16LE(end + 6) === 0,
    'unsupported archive trailer',
  );
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  requireRecovery(
    count > 0 &&
      count <= 4096 &&
      count === bytes.readUInt16LE(end + 8) &&
      at + bytes.readUInt32LE(end + 12) === end,
    'invalid archive directory',
  );
  const entries = new Map();
  const canonical = new Set();
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    requireRecovery(
      at + 46 <= end && bytes.readUInt32LE(at) === 0x02014b50,
      'invalid archive member',
    );
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    requireRecovery(
      next <= end &&
        (flags & 1) === 0 &&
        [0, 8].includes(method) &&
        size <= 300_000_000 &&
        ((bytes.readUInt32LE(at + 38) >>> 16) & 0xf000) !== 0xa000,
      'unsupported or oversized archive member',
    );
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    requireRecovery(
      name.length > 0 &&
        !name.includes('\\') &&
        !name.startsWith('/') &&
        !name.includes(':') &&
        ![...name].some((character) => character.charCodeAt(0) < 32) &&
        !name.split('/').some((part) => ['.', '..'].includes(part)) &&
        !canonical.has(name.normalize('NFC').toLowerCase()),
      'unsafe or duplicate archive path',
    );
    expanded += size;
    requireRecovery(expanded <= 1_000_000_000, 'archive expansion exceeds bound');
    canonical.add(name.normalize('NFC').toLowerCase());
    entries.set(name, { flags, method, compressed, size, offset: bytes.readUInt32LE(at + 42) });
    at = next;
  }
  requireRecovery(at === end, 'archive directory has trailing records');
  return (suffix, limit = 2 * 1024 * 1024) => {
    const matches = [...entries.keys()].filter(
      (name) => name === suffix || name.endsWith('/' + suffix),
    );
    requireRecovery(matches.length === 1, 'missing or ambiguous retained evidence member');
    const name = matches[0];
    const member = entries.get(name);
    const offset = member.offset;
    requireRecovery(
      member.size > 0 &&
        member.size <= limit &&
        offset + 30 <= bytes.length &&
        bytes.readUInt32LE(offset) === 0x04034b50 &&
        bytes.readUInt16LE(offset + 6) === member.flags &&
        bytes.readUInt16LE(offset + 8) === member.method,
      'invalid retained evidence member',
    );
    const nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    requireRecovery(
      start + member.compressed <= bytes.readUInt32LE(end + 16) &&
        bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8') === name,
      'archive member layout disagrees',
    );
    const data = bytes.subarray(start, start + member.compressed);
    const output = member.method === 0 ? data : inflateRawSync(data, { maxOutputLength: limit });
    requireRecovery(output.length === member.size, 'archive member size mismatch');
    return output;
  };
}
