import { z } from 'zod';
import type { CncTwoSidedSetup } from '../../core/scene/cnc-two-sided-setup';
const coord = z.number().finite().min(-1_000_000).max(1_000_000);
const ids = z
  .array(z.string().min(1).max(200))
  .max(100_000)
  .refine((values) => new Set(values).size === values.length);
const schema = z
  .object({
    activeSide: z.enum(['A', 'B']),
    flipAxis: z.enum(['x', 'y']),
    sideBStockOriginMm: z.object({ x: coord, y: coord }).strict(),
    sideAObjectIds: ids,
    sideBObjectIds: ids,
    registration: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            name: z.string().min(1).max(120),
            stockXMm: coord,
            stockYMm: coord,
            diameterMm: z.number().finite().positive().max(10_000),
          })
          .strict(),
      )
      .max(128)
      .refine((values) => new Set(values.map((item) => item.id)).size === values.length),
  })
  .strict();
export function normalizeCncTwoSidedSetup(value: unknown): CncTwoSidedSetup | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function validateCncTwoSidedSetup(value: unknown): string | null {
  return value === undefined || normalizeCncTwoSidedSetup(value) !== undefined
    ? null
    : 'invalid cncSetup.twoSided datum, side identities or registration features';
}
