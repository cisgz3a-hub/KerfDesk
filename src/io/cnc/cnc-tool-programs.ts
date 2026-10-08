import type { CncGroup } from '../../core/job';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES } from '../../core/preflight';
import { collectIndexedCncGroups } from '../../core/output/cnc-grbl-job-groups';
import { sha256Hex } from '../../core/relief/sha256';
import { emitPreparedGcode, type EmitGcodeOptions, type PreparedOutput } from '../gcode';
import { cncToolProgramFilename } from './cnc-program-filenames';
import { cncProgramReachWarnings } from './cnc-program-reach';

/** Plain values survive the Save worker's structured-clone boundary unchanged. */
export type CncToolProgram = {
  readonly order: number;
  readonly filename: string;
  readonly toolId: string | null;
  readonly toolName: string | null;
  readonly jobGroupIndices: ReadonlyArray<number>;
  readonly operationIds: ReadonlyArray<string>;
  readonly gcode: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly warnings: ReadonlyArray<string>;
};
export type CncToolProgramsResult =
  | { readonly kind: 'ready'; readonly programs: ReadonlyArray<CncToolProgram> }
  | { readonly kind: 'unavailable'; readonly message: string };
type PreparedCncOutput = Extract<PreparedOutput, { readonly ok: true }>;
type Section = { readonly groups: CncGroup[]; readonly indices: number[] };

/** Slice the already placed/compiled Job at each contiguous cutter change.
 * Re-emission uses the canonical prepared emitter, never source compilation or text splitting. */
export function buildCncToolPrograms(
  prepared: PreparedCncOutput,
  options: EmitGcodeOptions,
  combinedEmission?: ReturnType<typeof emitPreparedGcode>,
): CncToolProgramsResult {
  const sections = contiguousSections(prepared);
  if (prepared.project.machine?.kind !== 'cnc' || sections.length === 0)
    return { kind: 'unavailable', message: 'No prepared CNC cutter sections are available.' };
  const programs: CncToolProgram[] = [];
  for (const [index, section] of sections.entries()) {
    const result = emitSection(
      prepared,
      options,
      section,
      index + 1,
      sections.length === 1 ? combinedEmission : undefined,
    );
    if (typeof result === 'string') return { kind: 'unavailable', message: result };
    programs.push(result);
  }
  return { kind: 'ready', programs };
}

/** Renaming a package never changes its prepared program bytes or identities. */
export function nameCncToolPrograms(
  programs: ReadonlyArray<CncToolProgram>,
  baseFilename: string,
): ReadonlyArray<CncToolProgram> {
  return programs.map((program) => ({
    ...program,
    filename: cncToolProgramFilename(baseFilename, program.order, program.toolId),
  }));
}

function contiguousSections(prepared: PreparedCncOutput): ReadonlyArray<Section> {
  const sections: Section[] = [];
  for (const { group, jobGroupIndex } of collectIndexedCncGroups(prepared.job)) {
    let section = sections.at(-1);
    if (section === undefined || (section.groups[0]?.toolId ?? '') !== (group.toolId ?? '')) {
      section = { groups: [], indices: [] };
      sections.push(section);
    }
    section.groups.push(group);
    section.indices.push(jobGroupIndex);
  }
  return sections;
}

function emitSection(
  prepared: PreparedCncOutput,
  options: EmitGcodeOptions,
  section: Section,
  order: number,
  retainedEmission?: ReturnType<typeof emitPreparedGcode>,
): CncToolProgram | string {
  const first = section.groups[0];
  if (first === undefined) return 'A prepared CNC cutter section is empty.';
  const emitted =
    retainedEmission ??
    emitPreparedGcode(
      { ...prepared, job: { ...prepared.job, groups: section.groups } },
      { ...options, sourceGeometryChecks: 'compiled-evidence-only' },
    );
  const failures = emitted.preflight.issues.filter((issue) =>
    COMPILE_INTEGRITY_PREFLIGHT_CODES.has(issue.code),
  );
  if (emitted.gcode.length === 0 || failures.length > 0)
    return `Separate-tool export section ${order} could not be emitted: ${failures.map((issue) => issue.message).join(' ') || 'no executable bytes'}`;
  const bytes = new TextEncoder().encode(emitted.gcode);
  const toolId = first.toolId ?? null;
  const toolName = first.toolName ?? null;
  return {
    order,
    filename: cncToolProgramFilename('job.gcode', order, toolId),
    toolId,
    toolName,
    jobGroupIndices: [...section.indices],
    operationIds: section.groups.map((group) => group.layerId),
    gcode: emitted.gcode,
    sha256: 'sha256:' + sha256Hex([bytes]),
    byteLength: bytes.length,
    warnings: [
      ...emitted.preflight.issues.map((issue) => issue.message),
      ...cncProgramReachWarnings(prepared.project, emitted.gcode, [{ id: toolId, name: toolName }]),
    ],
  };
}
