import { validateCncWrapStudy, parseCncWrapStudy } from './project-cnc-wrap-study-validator';
import {
  normalizeCncTwoSidedSetup,
  validateCncTwoSidedSetup,
} from './project-cnc-two-sided-validator';
import type { CncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { isObject } from './project-shape-primitives';

export function validateCncMachiningSetup(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value) || !text(value['id'], 120) || !text(value['name'], 120)) {
    return 'invalid cncSetup identity';
  }
  if (typeof value['notes'] !== 'string' || value['notes'].length > 4000)
    return 'invalid cncSetup notes';
  if (value['wcs'] !== 'G54' || value['zDatum'] !== 'stock-top')
    return 'unsupported cncSetup coordinate convention';
  const wrapIssue = validateCncWrapStudy(value['wrapStudy']);
  if (wrapIssue !== null) return wrapIssue;
  const sideIssue = validateCncTwoSidedSetup(value['twoSided']);
  if (sideIssue !== null) return sideIssue;
  return validateSetupFixtures(value['fixtures']);
}

function validateSetupFixtures(fixtures: unknown): string | null {
  if (!Array.isArray(fixtures) || fixtures.length > 128) return 'invalid cncSetup fixtures';
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (!isObject(fixture) || !text(fixture['id'], 120) || !text(fixture['name'], 120))
      return 'invalid CNC fixture identity';
    const id = fixture['id'] as string;
    if (ids.has(id)) return 'duplicate CNC fixture id';
    ids.add(id);
    if (
      !['xMm', 'yMm', 'widthMm', 'heightMm', 'bottomZMm', 'topZMm'].every((key) =>
        coordinate(fixture[key]),
      )
    )
      return 'invalid CNC fixture dimensions';
    if (
      (fixture['widthMm'] as number) <= 0 ||
      (fixture['heightMm'] as number) <= 0 ||
      (fixture['topZMm'] as number) <= (fixture['bottomZMm'] as number)
    )
      return 'CNC fixture dimensions must be positive';
  }
  return null;
}

export function normalizeCncMachiningSetup(value: unknown): CncMachiningSetup | undefined {
  if (value === undefined || validateCncMachiningSetup(value) !== null || !isObject(value))
    return undefined;
  const wrap = parseCncWrapStudy(value['wrapStudy']);
  const side = normalizeCncTwoSidedSetup(value['twoSided']);
  return {
    ...(wrap.kind === 'ok' && wrap.value !== undefined ? { wrapStudy: wrap.value } : {}),
    ...(side === undefined ? {} : { twoSided: side }),
    id: value['id'] as string,
    name: value['name'] as string,
    notes: value['notes'] as string,
    wcs: 'G54',
    zDatum: 'stock-top',
    fixtures: (value['fixtures'] as CncMachiningSetup['fixtures']).map((fixture) => ({
      ...fixture,
    })),
  };
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}
