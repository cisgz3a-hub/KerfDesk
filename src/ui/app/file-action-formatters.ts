import type { deserializeProject } from '../../io/project';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function suggestedGcodeName(savedName: string | null): string {
  if (savedName === null) return 'untitled.gcode';
  return `${savedName.replace(/\.(lf2|json)$/i, '')}.gcode`;
}

export function describeOpenResult(
  result: Exclude<ReturnType<typeof deserializeProject>, { kind: 'ok' }>,
): string {
  if (result.kind === 'invalid') return result.reason;
  if (result.kind === 'schema-too-new') return `unsupported version ${result.sawVersion}`;
  if (result.kind === 'schema-too-old') return `legacy version ${result.sawVersion}`;
  return 'unknown error';
}
