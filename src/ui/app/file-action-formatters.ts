import type { deserializeProject } from '../../io/project';

export { errorMessage } from '../../core/util/error-message';

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

/** An empty project file, refused before parsing (UX audit U5-P3-8). */
export const EMPTY_PROJECT_FILE = { kind: 'invalid', reason: 'the file is empty' } as const;

const DESIGN_UNCHANGED = 'Your current design is unchanged.';

/** The open-failure toast for a beginner: what happened to the file and what
 *  to do, with the parser's own words folded under the toast's details (UX
 *  audit U5-P3-8). */
export function projectOpenFailure(
  fileName: string,
  result: Exclude<ReturnType<typeof deserializeProject>, { kind: 'ok' }>,
): { readonly message: string; readonly details: ReadonlyArray<string> } {
  const reason = describeOpenResult(result);
  if (result.kind === 'invalid' && result.reason === EMPTY_PROJECT_FILE.reason) {
    return {
      message: `${fileName} is empty, so there is nothing to open. ${DESIGN_UNCHANGED} Open an earlier copy of the file if you have one.`,
      details: [],
    };
  }
  if (result.kind === 'invalid') {
    return {
      message: `${fileName} is damaged or incomplete (it may have been cut off while saving or copying), so KerfDesk can't open it. ${DESIGN_UNCHANGED} Open an earlier copy of the file if you have one.`,
      details: [`Could not open ${fileName}: ${reason}`],
    };
  }
  return { message: `Could not open ${fileName}: ${reason}`, details: [] };
}
