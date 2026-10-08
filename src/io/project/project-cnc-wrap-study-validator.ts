import { z } from 'zod';
import type { CncWrapStudy } from '../../core/scene/cnc-wrap-study';
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const study = z
  .object({
    capabilityId: z.literal('grblhal-degrees-g93-reference-v1'),
    radiusMm: z.number().finite().positive().max(100_000),
    circumferentialAxis: z.enum(['x', 'y']),
    rotaryAxis: z.literal('A'),
    direction: z.union([z.literal(1), z.literal(-1)]),
    seamMm: coordinate,
    rotaryDatumDeg: coordinate,
    axialDatumMm: coordinate,
    radialClearanceMm: z.number().finite().positive().max(100_000),
  })
  .strict();
export function parseCncWrapStudy(
  raw: unknown,
):
  | { readonly kind: 'ok'; readonly value: CncWrapStudy | undefined }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (raw === undefined) return { kind: 'ok', value: undefined };
  const parsed = study.safeParse(raw);
  return parsed.success
    ? { kind: 'ok', value: parsed.data }
    : { kind: 'invalid', reason: 'Invalid CNC wrap reference-study axes, units, radius or datum.' };
}
export function validateCncWrapStudy(raw: unknown): string | null {
  const result = parseCncWrapStudy(raw);
  return result.kind === 'invalid' ? result.reason : null;
}
