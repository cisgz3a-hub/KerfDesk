// The bits a KerfDesk CNC program says it cuts with (ADR-426). Every CNC
// operation opens with inert comments naming its tool and the geometry it was
// compiled for, so an opened file carries the same facts as a fresh compile:
//
//   ; cnc tool-id: <id>
//   ; cnc tool-name: <name>
//   ; cnc tool: <kind>; diameter-mm: <d>[; angle-deg: <a>][; tip-diameter-mm: <t>]
//
// The Tool lens colours each bit on its own, and Studio draws the bit that is
// cutting at the playhead. Programs from elsewhere have no such comments and
// fall back to their T words, or to one toolpath.

import type { CncToolKind } from '../../core/scene';

export type ProgramToolGeometry = {
  readonly kind: CncToolKind;
  readonly diameterMm: number;
  readonly tipAngleDeg?: number;
  readonly tipDiameterMm?: number;
};

/** A tool the program starts cutting with on a raw (zero-based) source line. */
export type ProgramToolMark = {
  readonly line: number;
  /** What makes two marks the same bit: its id, else its name, else its geometry. */
  readonly key: string;
  readonly label: string;
  readonly geometry: ProgramToolGeometry | null;
  readonly toolId: string | null;
};

const TOOL_KINDS: ReadonlyArray<CncToolKind> = [
  'end-mill',
  'ball-nose',
  'v-bit',
  'engraving',
  'tapered-ball-nose',
];
const KIND_LABEL: Readonly<Record<CncToolKind, string>> = {
  'end-mill': 'end mill',
  'ball-nose': 'ball nose',
  'v-bit': 'V-bit',
  engraving: 'engraving bit',
  'tapered-ball-nose': 'tapered ball nose',
};
const ID_PREFIX = '; cnc tool-id: ';
const NAME_PREFIX = '; cnc tool-name: ';
const GEOMETRY_PREFIX = '; cnc tool: ';
const LAYER_PREFIX = '; cnc layer-id: ';

/** Reads tool marks from lines as they stream past, so the source is read once. */
export function programToolCollector(): {
  readonly observe: (text: string) => void;
  readonly marks: ProgramToolMark[];
} {
  const marks: ProgramToolMark[] = [];
  let line = 0;
  let toolId: string | null = null;
  let name: string | null = null;
  return {
    observe: (text) => {
      if (text.startsWith('; cnc ')) {
        const trimmed = text.trimEnd();
        if (trimmed.startsWith(LAYER_PREFIX)) toolId = name = null;
        else if (trimmed.startsWith(ID_PREFIX)) toolId = valueAfter(trimmed, ID_PREFIX);
        else if (trimmed.startsWith(NAME_PREFIX)) name = valueAfter(trimmed, NAME_PREFIX);
        else if (trimmed.startsWith(GEOMETRY_PREFIX)) {
          marks.push(toolMark(line, toolId, name, parseToolGeometry(trimmed)));
          toolId = name = null;
        }
      }
      line += 1;
    },
    marks,
  };
}

function toolMark(
  line: number,
  toolId: string | null,
  name: string | null,
  geometry: ProgramToolGeometry | null,
): ProgramToolMark {
  const described = geometry === null ? 'Unnamed tool' : describeGeometry(geometry);
  return {
    line,
    key: toolId ?? name ?? described,
    label: name ?? described,
    geometry,
    toolId,
  };
}

/** Kind and sizes from a `; cnc tool:` comment; null when it names no known kind. */
export function parseToolGeometry(line: string): ProgramToolGeometry | null {
  const fields = line.slice(GEOMETRY_PREFIX.length).split(';');
  const kind = TOOL_KINDS.find((candidate) => candidate === fields[0]?.trim());
  const diameterMm = numberField(fields, 'diameter-mm');
  if (kind === undefined || diameterMm === undefined || diameterMm <= 0) return null;
  const tipAngleDeg = numberField(fields, 'angle-deg');
  const tipDiameterMm = numberField(fields, 'tip-diameter-mm');
  return {
    kind,
    diameterMm,
    ...(tipAngleDeg === undefined ? {} : { tipAngleDeg }),
    ...(tipDiameterMm === undefined ? {} : { tipDiameterMm }),
  };
}

function numberField(fields: ReadonlyArray<string>, key: string): number | undefined {
  for (const field of fields) {
    const [name, value] = field.split(':');
    if (name?.trim() !== key || value === undefined) continue;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function valueAfter(line: string, prefix: string): string | null {
  const value = line.slice(prefix.length).trim();
  return value === '' || value === '(blank)' ? null : value;
}

function describeGeometry(geometry: ProgramToolGeometry): string {
  const angle = geometry.tipAngleDeg === undefined ? '' : ` ${trim(geometry.tipAngleDeg)}°`;
  return `${trim(geometry.diameterMm)} mm${angle} ${KIND_LABEL[geometry.kind]}`;
}

function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}
