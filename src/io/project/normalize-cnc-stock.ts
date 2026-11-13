// Reads a saved CNC stock block (.lf2 machine.stock), moved out of
// deserialize-project.ts with ADR-258 Amendment 6.

import { isChiploadMaterialKey } from '../../core/cnc';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncStock } from '../../core/scene';
import { isPositiveFiniteNumber } from '../../core/util/finite';
import { isObject } from './project-shape-primitives';

export function normalizeCncStock(stock: Record<string, unknown>): CncStock {
  const d = DEFAULT_CNC_MACHINE_CONFIG.stock;
  return {
    thicknessMm: positiveOr(stock['thicknessMm'], d.thicknessMm),
    widthMm: positiveOr(stock['widthMm'], d.widthMm),
    heightMm: positiveOr(stock['heightMm'], d.heightMm),
    originOffset: normalizeStockOriginOffset(stock['originOffset'], d.originOffset),
    // ADR-112 project material: keep only a known chipload key; drop stale ones.
    ...(isChiploadMaterialKey(stock['materialKey']) ? { materialKey: stock['materialKey'] } : {}),
    // ADR-258 Amendment 6: only an explicit true marks the thickness as set. A
    // project saved before the mark reads by value (setStockThicknessMm).
    ...(stock['thicknessSet'] === true ? { thicknessSet: true as const } : {}),
  };
}

// Finite and positive: a JSON `1e999` parses to Infinity and would otherwise
// ride through into emitted G-code (e.g. "G0 ZInfinity").
function positiveOr(value: unknown, fallback: number): number {
  return isPositiveFiniteNumber(value) ? value : fallback;
}

function normalizeStockOriginOffset(
  raw: unknown,
  fallback: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  if (!isObject(raw)) return { ...fallback };
  const x = raw['x'];
  const y = raw['y'];
  if (typeof x !== 'number' || !Number.isFinite(x)) return { ...fallback };
  if (typeof y !== 'number' || !Number.isFinite(y)) return { ...fallback };
  return { x, y };
}
