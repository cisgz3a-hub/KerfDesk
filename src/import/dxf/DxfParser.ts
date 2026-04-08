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

export function parseDxf(text: string): DxfFile {
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

        i += 2;
      }

      entities.push(entity);
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
