/**
 * Minimal DXF parser for laser-relevant entities.
 * Handles: LINE, CIRCLE, ARC, LWPOLYLINE, ELLIPSE, POLYLINE/VERTEX, POINT
 */

export interface DxfEntity {
  type: string;
  layer?: string;
  color?: number;
  data: Map<number, string[]>;  // group code → values (multiple entries possible)
}

export interface DxfFile {
  entities: DxfEntity[];
}

export const DXF_IMPORT_LIMITS = {
  MAX_FILE_BYTES: 50 * 1024 * 1024,
  MAX_ENTITY_COUNT: 500_000,
  MAX_GROUPS_PER_ENTITY: 10_000,
} as const;

export type DxfImportLimitKey = keyof typeof DXF_IMPORT_LIMITS;

export class DxfImportLimitError extends Error {
  override readonly name = 'DxfImportLimitError';
  readonly limit: DxfImportLimitKey;
  readonly observed: number;
  readonly maximum: number;

  constructor(limit: DxfImportLimitKey, observed: number, maximum = DXF_IMPORT_LIMITS[limit]) {
    super(`DXF ${limit} exceeded: observed ${observed}, limit ${maximum}`);
    this.limit = limit;
    this.observed = observed;
    this.maximum = maximum;
    Object.setPrototypeOf(this, DxfImportLimitError.prototype);
  }
}

export interface DxfParseLimits {
  maxFileBytes: number;
  maxEntities: number;
  maxGroupsPerEntity: number;
}

function resolveLimits(overrides: Partial<DxfParseLimits> = {}): DxfParseLimits {
  return {
    maxFileBytes: overrides.maxFileBytes ?? DXF_IMPORT_LIMITS.MAX_FILE_BYTES,
    maxEntities: overrides.maxEntities ?? DXF_IMPORT_LIMITS.MAX_ENTITY_COUNT,
    maxGroupsPerEntity: overrides.maxGroupsPerEntity ?? DXF_IMPORT_LIMITS.MAX_GROUPS_PER_ENTITY,
  };
}

function utf8ByteLengthExceeds(text: string, limit: number): { exceeds: boolean; observed: number } {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) return { exceeds: true, observed: bytes };
  }
  return { exceeds: false, observed: bytes };
}

export function assertDxfFileSize(bytes: number, maxBytes = DXF_IMPORT_LIMITS.MAX_FILE_BYTES): void {
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > maxBytes) {
    throw new DxfImportLimitError('MAX_FILE_BYTES', bytes, maxBytes);
  }
}

function assertDxfTextSize(text: string, maxBytes: number): void {
  const result = utf8ByteLengthExceeds(text, maxBytes);
  if (result.exceeds) {
    throw new DxfImportLimitError('MAX_FILE_BYTES', result.observed, maxBytes);
  }
}

export function parseDxf(text: string, limitOverrides: Partial<DxfParseLimits> = {}): DxfFile {
  const limits = resolveLimits(limitOverrides);
  assertDxfTextSize(text, limits.maxFileBytes);
  const lines = text.split(/\r?\n/);
  const entities: DxfEntity[] = [];

  let i = 0;
  let inEntities = false;

  // Find ENTITIES section
  while (i < lines.length - 1) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1]?.trim() || '';
    i += 2;

    if (code === 0 && value === 'SECTION') {
      // Check next pair for section name
      if (i < lines.length - 1) {
        const nextCode = parseInt(lines[i].trim(), 10);
        const nextValue = lines[i + 1]?.trim() || '';
        if (nextCode === 2 && nextValue === 'ENTITIES') {
          inEntities = true;
          i += 2;
          continue;
        }
      }
    }

    if (!inEntities) continue;

    if (code === 0 && value === 'ENDSEC') break;

    if (code === 0) {
      // Start of a new entity
      const entity: DxfEntity = {
        type: value,
        data: new Map(),
      };
      let groupCount = 0;

      // Read all group code pairs until next entity (code 0)
      while (i < lines.length - 1) {
        const gc = parseInt(lines[i].trim(), 10);
        const gv = lines[i + 1]?.trim() || '';

        if (gc === 0) break; // Next entity starts

        if (gc === 8) entity.layer = gv;
        if (gc === 62) entity.color = parseInt(gv, 10);

        const existing = entity.data.get(gc) || [];
        existing.push(gv);
        entity.data.set(gc, existing);
        groupCount++;
        if (groupCount > limits.maxGroupsPerEntity) {
          throw new DxfImportLimitError(
            'MAX_GROUPS_PER_ENTITY',
            groupCount,
            limits.maxGroupsPerEntity,
          );
        }

        i += 2;
      }

      entity.layer = entity.layer ?? entity.data.get(8)?.[0] ?? '0';
      entities.push(entity);
      if (entities.length > limits.maxEntities) {
        throw new DxfImportLimitError(
          'MAX_ENTITY_COUNT',
          entities.length,
          limits.maxEntities,
        );
      }
    }
  }

  return { entities };
}

// Helper to get a single numeric value from entity data
export function getNum(entity: DxfEntity, code: number, fallback: number = 0): number {
  const vals = entity.data.get(code);
  return vals && vals.length > 0 ? parseFloat(vals[0]) : fallback;
}

// Helper to get all numeric values for a code (e.g., all X coordinates)
export function getAllNums(entity: DxfEntity, code: number): number[] {
  const vals = entity.data.get(code);
  return vals ? vals.map(v => parseFloat(v)) : [];
}
