import { z } from 'zod';
import type { ImportedSvg } from '../../core/scene/scene-object';
import type {
  PartGeneratorSource,
  PartGeneratorResult,
  PartGeneratorDefinition,
} from '../../core/parts/part-generator';
import { materializePartGenerator } from '../../core/parts/materialize-part-generator';

const dimension = z.number().finite().positive().max(100000);
const common = {
  name: z.string().trim().min(1).max(200),
  widthMm: dimension,
  heightMm: dimension,
  holeDiameterMm: dimension,
};
const grid = {
  rows: z.number().int().min(1).max(32),
  columns: z.number().int().min(1).max(32),
  edgeOffsetMm: dimension,
};
const definition = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('panel'), edgeOffsetMm: dimension }).strict(),
  z
    .object({
      ...common,
      kind: z.literal('bracket'),
      legWidthMm: dimension,
      holeOffsetMm: dimension,
    })
    .strict(),
  z.object({ ...common, ...grid, kind: z.literal('hole-grid') }).strict(),
  z
    .object({
      ...common,
      ...grid,
      kind: z.literal('fixture'),
      mountOffsetMm: dimension,
      mountDiameterMm: dimension,
    })
    .strict(),
]);
const source = z
  .object({
    version: z.literal(1),
    definition,
    pathKeys: z.array(z.string().min(1).max(80)).min(1).max(517),
  })
  .strict();
export function parsePartGeneratorSource(
  value: unknown,
): PartGeneratorResult<PartGeneratorSource | undefined> {
  if (value === undefined) return { kind: 'ok', value: undefined };
  const parsed = source.safeParse(value);
  if (!parsed.success)
    return { kind: 'invalid', reason: 'Malformed or over-budget part generator source.' };
  const generated = materializePartGenerator(parsed.data.definition);
  if (generated.kind === 'invalid') return generated;
  const keys = generated.value.source.pathKeys;
  if (
    keys.length !== parsed.data.pathKeys.length ||
    keys.some((key, index) => key !== parsed.data.pathKeys[index])
  )
    return {
      kind: 'invalid',
      reason: 'Part generator semantic path identities do not match its definition.',
    };
  return { kind: 'ok', value: generated.value.source };
}
export function validatePartGeneratorSource(value: unknown): string | null {
  const parsed = parsePartGeneratorSource(value);
  return parsed.kind === 'invalid' ? parsed.reason : null;
}
export function normalizePartGeneratorObject(object: ImportedSvg): ImportedSvg {
  const parsed = parsePartGeneratorSource(object.partGenerator);
  return parsed.kind === 'ok' && parsed.value !== undefined
    ? { ...object, partGenerator: parsed.value }
    : object;
}

export function parsePartGeneratorDefinition(
  value: unknown,
): PartGeneratorResult<PartGeneratorDefinition> {
  const parsed = definition.safeParse(value);
  if (!parsed.success)
    return { kind: 'invalid', reason: 'Malformed or over-budget part generator dimensions.' };
  const generated = materializePartGenerator(parsed.data);
  return generated.kind === 'invalid'
    ? generated
    : { kind: 'ok', value: generated.value.source.definition };
}
