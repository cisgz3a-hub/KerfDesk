// Rebuilds a loaded project's CNC tool list for deserializeProject.

import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
import { DEFAULT_CNC_TOOLS, type CncTool } from '../../core/scene';

// Tools are rebuilt field-by-field like stock/params: `diameterMm: 1e999`
// parses to Infinity and previously rode `> 0` straight into the CNC offset
// math, then poisoned Save (Infinity serializes to null, the round-trip drops
// the tool, and the semantic-drift guard refuses without naming it). A tool
// failing the load-bearing fields is dropped; junk in optional fields drops
// the field, and an unknown kind degrades to end-mill (same junk-to-default
// contract as coolantModeOrOff).
const CNC_TOOL_KINDS = [
  'end-mill',
  'ball-nose',
  'v-bit',
  'engraving',
  'tapered-ball-nose',
] as const;
const MAX_TOOL_METADATA_LENGTH = 120;

export function normalizeCncTools(raw: unknown): Array<CncTool> {
  if (!Array.isArray(raw)) return DEFAULT_CNC_TOOLS.map((tool) => ({ ...tool }));
  const tools: Array<CncTool> = [];
  for (const tool of raw) {
    const normalized = normalizeCncTool(tool);
    if (normalized !== null) tools.push(normalized);
  }
  return tools.length > 0 ? tools : DEFAULT_CNC_TOOLS.map((tool) => ({ ...tool }));
}

function normalizeCncTool(tool: unknown): CncTool | null {
  if (!isObject(tool)) return null;
  const core = normalizeCncToolCore(tool);
  if (core === null) return null;
  return { ...core, ...normalizeCncToolMetadata(tool) };
}

function normalizeCncToolCore(tool: Record<string, unknown>): CncTool | null {
  if (typeof tool['id'] !== 'string') return null;
  if (typeof tool['name'] !== 'string') return null;
  const diameterMm = tool['diameterMm'];
  if (!isFiniteNumber(diameterMm) || diameterMm <= 0) return null;
  return {
    id: tool['id'],
    name: tool['name'],
    kind: isCncToolKindValue(tool['kind']) ? tool['kind'] : 'end-mill',
    diameterMm,
  };
}

function normalizeCncToolMetadata(tool: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const family = boundedToolString(tool['family']);
  const catalogId = boundedToolString(tool['catalogId']);
  if (isValidCncTipAngleDeg(tool['tipAngleDeg'])) {
    metadata['tipAngleDeg'] = tool['tipAngleDeg'];
  }
  // Keep an explicit finite malformed flat visible. Dropping the field would
  // silently turn the saved cutter into the supported pointed law on reload.
  // A tapered ball nose keeps its tip ball the same way (ADR-368).
  if (keepsTipDiameter(tool['kind']) && isFiniteNumber(tool['tipDiameterMm'])) {
    metadata['tipDiameterMm'] = tool['tipDiameterMm'];
  }
  if (family !== null) metadata['family'] = family;
  if (isFiniteNumber(tool['shankDiameterMm']) && tool['shankDiameterMm'] > 0) {
    metadata['shankDiameterMm'] = tool['shankDiameterMm'];
  }
  if (validFluteCount(tool['fluteCount'])) metadata['fluteCount'] = tool['fluteCount'];
  if (catalogId !== null) metadata['catalogId'] = catalogId;
  return metadata;
}

function keepsTipDiameter(kind: unknown): boolean {
  return kind === 'engraving' || kind === 'tapered-ball-nose';
}

function validFluteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function boundedToolString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOOL_METADATA_LENGTH
    ? value
    : null;
}

function isCncToolKindValue(value: unknown): value is (typeof CNC_TOOL_KINDS)[number] {
  return typeof value === 'string' && (CNC_TOOL_KINDS as ReadonlyArray<string>).includes(value);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
