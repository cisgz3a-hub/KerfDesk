/**
 * Fast deterministic fingerprints for ValidatedJobTicket (mismatch detection only;
 * not a security primitive).
 */

/** 32-bit FNV-1a. Output is 8 lowercase hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Hash JSON-serializable values with sorted object keys (order-independent). */
export function hashObject(obj: unknown): string {
  return hashString(canonicalJson(obj));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = o[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

let ticketSeq = 0;

function isDeterministicIds(): boolean {
  if (typeof process !== 'undefined' && process.env?.LASERFORGE_DETERMINISTIC_IDS === '1') {
    return true;
  }
  if (typeof globalThis !== 'undefined') {
    return (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ === true;
  }
  return false;
}

/** Unique per compile. Not a content hash. */
export function generateTicketId(): string {
  if (isDeterministicIds()) {
    ticketSeq += 1;
    return `tkt_det_${String(ticketSeq).padStart(6, '0')}`;
  }
  return `tkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
