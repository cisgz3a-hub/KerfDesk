export const PROJECT_CHECKSUM_ALGORITHM = 'sha256-canonical-scene-v1';

export type ProjectChecksumResult =
  | { kind: 'match'; checksum: string }
  | { kind: 'no-checksum' }
  | { kind: 'mismatch'; expected: string; actual: string };

export class ProjectChecksumMismatchError extends Error {
  readonly result: Extract<ProjectChecksumResult, { kind: 'mismatch' }>;

  constructor(result: Extract<ProjectChecksumResult, { kind: 'mismatch' }>) {
    super('Project file checksum mismatch');
    this.name = 'ProjectChecksumMismatchError';
    this.result = result;
  }
}

export class ProjectChecksumLoadCancelledError extends Error {
  constructor() {
    super('Project file load cancelled after checksum mismatch');
    this.name = 'ProjectChecksumLoadCancelledError';
  }
}

export function canonicalJson(value: unknown): string {
  const encoded = encodeCanonicalJson(value);
  return encoded === undefined ? 'null' : encoded;
}

function encodeCanonicalJson(value: unknown): string | undefined {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value as number) ? JSON.stringify(value) : 'null';
  if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;

  if (Array.isArray(value)) {
    return `[${value.map(item => encodeCanonicalJson(item) ?? 'null').join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      const encodedValue = encodeCanonicalJson(obj[key]);
      if (encodedValue === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${encodedValue}`);
    }
    return `{${parts.join(',')}}`;
  }

  return undefined;
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = BigInt(bytes.length) * 8n;
  const withOne = bytes.length + 1;
  const zeroPad = withOne % 64 <= 56
    ? 56 - (withOne % 64)
    : 64 + 56 - (withOne % 64);
  const data = new Uint8Array(withOne + zeroPad + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;
  for (let i = 0; i < 8; i++) {
    data[data.length - 1 - i] = Number((bitLength >> BigInt(i * 8)) & 0xffn);
  }

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const k = SHA256_K;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (
        (data[j] << 24)
        | (data[j + 1] << 16)
        | (data[j + 2] << 8)
        | data[j + 3]
      ) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return Array.from(h, n => n.toString(16).padStart(8, '0')).join('');
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function buildSceneChecksum(scenePayload: unknown): string {
  return sha256Hex(canonicalJson(scenePayload));
}

export function validateSceneFileChecksum(envelope: unknown): ProjectChecksumResult {
  if (!envelope || typeof envelope !== 'object') return { kind: 'no-checksum' };
  const file = envelope as { checksum?: unknown; scene?: unknown };
  if (typeof file.checksum !== 'string' || file.checksum.length === 0) {
    return { kind: 'no-checksum' };
  }
  const expected = buildSceneChecksum(file.scene);
  const actual = file.checksum.toLowerCase();
  if (expected === actual) return { kind: 'match', checksum: actual };
  return { kind: 'mismatch', expected, actual };
}

export function projectChecksumMismatchWarning(result: ProjectChecksumResult): string {
  if (result.kind !== 'mismatch') {
    return 'File integrity check failed.\n\nThe project file could not be verified.';
  }
  return [
    'File integrity check failed',
    '',
    "The project file's checksum does not match its contents. This usually means:",
    '- The file was edited externally',
    '- The file was corrupted during transfer',
    '- The file was truncated',
    '',
    'You can still try to load it, but the project may behave unexpectedly.',
    '',
    `Expected: ${result.expected}`,
    `Actual: ${result.actual}`,
  ].join('\n');
}

export async function confirmProjectChecksumMismatch(
  result: ProjectChecksumResult,
  showConfirm: (title: string, message: string) => Promise<boolean>,
): Promise<boolean> {
  if (result.kind !== 'mismatch') return true;
  return showConfirm('File integrity check failed', projectChecksumMismatchWarning(result));
}
