import { sha256Hex } from '../../core/relief/sha256';
import { encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import type { CncProgramFacts } from './cnc-program-facts';
import { safeProgramFilename } from './cnc-program-filenames';
import { nameCncToolPrograms, type CncToolProgram } from './cnc-tool-programs';

export type CncSetupExportMode = 'single-file' | 'separate-tools';
export type CncSetupPackageInput = {
  readonly gcode: string;
  readonly facts: CncProgramFacts;
  readonly programFilename: string;
  readonly exportMode?: CncSetupExportMode;
  readonly cncToolPrograms?: ReadonlyArray<CncToolProgram>;
};
type ProgramFile = Pick<
  CncToolProgram,
  'order' | 'filename' | 'gcode' | 'sha256' | 'byteLength'
> & {
  readonly toolId?: string | null;
  readonly toolName?: string | null;
  readonly operationIds?: ReadonlyArray<string>;
  readonly jobGroupIndices?: ReadonlyArray<number>;
  readonly warnings: ReadonlyArray<string>;
};

/** Select already emitted bytes. A manifest alone can never manufacture a missing tool program. */
export function cncSetupPackage(input: CncSetupPackageInput) {
  const mode = input.exportMode ?? 'single-file';
  const filename = safeProgramFilename(input.programFilename);
  const bytes = new TextEncoder().encode(input.gcode);
  const programSha256 = 'sha256:' + sha256Hex([bytes]);
  const combined = { filename, sha256: programSha256, byteLength: bytes.length };
  let files: ReadonlyArray<ProgramFile> = [
    { order: 1, ...combined, gcode: input.gcode, warnings: [] },
  ];
  if (mode === 'separate-tools') {
    validateToolPrograms(input);
    files = nameCncToolPrograms(input.cncToolPrograms ?? [], filename);
  }
  return {
    mode,
    filename,
    programSha256,
    files,
    manifest: {
      exportMode: mode,
      ...(mode === 'single-file' ? { program: combined } : {}),
      combinedProgram: { sha256: programSha256, byteLength: bytes.length },
      programs: files.map(({ gcode: _gcode, ...file }) => file),
    },
  };
}

function validateToolPrograms(input: CncSetupPackageInput): void {
  const programs = input.cncToolPrograms;
  if (programs === undefined || programs.length === 0)
    throw new Error('Separate-tool output requires programs emitted from the prepared Job.');
  if (programs.length !== input.facts.toolPlan.length)
    throw new Error('Prepared cutter-section count differs from the exact job tool order.');
  const operationIds = programs.flatMap((program) => program.operationIds);
  if (
    JSON.stringify(operationIds) !==
    JSON.stringify(input.facts.operations.map((operation) => operation.operationId))
  )
    throw new Error('Prepared cutter-section operations differ from the exact job order.');
  for (const [index, program] of programs.entries()) {
    if (!validToolProgram(program, index, input.facts.toolPlan[index]?.id ?? null))
      throw new Error('A prepared cutter-section identity or byte digest no longer matches.');
  }
}

function validToolProgram(program: CncToolProgram, index: number, toolId: string | null): boolean {
  const bytes = new TextEncoder().encode(program.gcode);
  return (
    program.order === index + 1 &&
    (program.toolId ?? '') === (toolId ?? '') &&
    bytes.length > 0 &&
    bytes.length === program.byteLength &&
    'sha256:' + sha256Hex([bytes]) === program.sha256
  );
}
export function cncSetupProgramDownloads(files: ReadonlyArray<ProgramFile>): string {
  return files
    .map(
      (file) =>
        `<a download="${escapeSetupText(file.filename)}" href="data:application/octet-stream;base64,${encodeCanonicalBase64(new TextEncoder().encode(file.gcode))}">Download ${escapeSetupText(file.filename)}</a>`,
    )
    .join('');
}

export function cncSetupProgramInstructions(
  mode: CncSetupExportMode,
  files: ReadonlyArray<ProgramFile>,
  facts: CncProgramFacts,
): string {
  if (mode === 'single-file')
    return `<p>Single-file program. Manual tool changes follow this order: ${facts.toolPlan.map((entry) => escapeSetupText(entry.name ?? entry.id ?? 'Default bit')).join(' → ')}. At each M0, load the indicated cutter, keep the same G54 XY datum, re-zero Z on stock top and remove the touch-off plate before resuming.</p>`;
  const rows = files
    .map(
      (file) =>
        `<tr><td>${file.order}</td><td>${escapeSetupText(file.filename)}</td><td>${escapeSetupText(file.toolName ?? file.toolId ?? 'Default bit')}</td><td>${file.byteLength}</td><td><small>${file.sha256}</small></td></tr>`,
    )
    .join('');
  return `<h2>Ordered separate-tool programs</h2><p>Run every file in the listed order, including a later return to the same cutter. Each file is a complete program: modal setup, safe lift before spindle start, then retract, M5, coolant off when used, park and end of file. These files contain no tool-change M0; change tools between files.</p><p>Before each file: wait for the previous program to finish and the spindle to stop, load its listed cutter, keep the same G54 XY datum, re-zero Z on stock top and remove the touch-off plate. Load the exact filename below and start that file from its beginning. Do not resume the combined program or concatenate these files.</p><table><thead><tr><th>Run order</th><th>Exact filename</th><th>Load and touch off cutter</th><th>UTF-8 bytes</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function escapeSetupText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
