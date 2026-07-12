import type { Project } from '../../core/scene';
import { emitPreparedGcode, type EmitGcodeOptions, type EmitGcodeResult } from './emit-gcode';
import {
  prepareOutputSnapshot,
  type PrepareOutputSnapshotOptions,
} from './prepare-output-snapshot';

export type EmitGcodeSnapshotOptions = EmitGcodeOptions &
  Pick<
    PrepareOutputSnapshotOptions,
    'clock' | 'recordIndex' | 'serialValue' | 'renderVariableText'
  >;

export async function emitGcodeSnapshot(
  project: Project,
  options: EmitGcodeSnapshotOptions,
): Promise<EmitGcodeResult> {
  const prepared = await prepareOutputSnapshot(project, {
    clock: options.clock,
    renderVariableText: options.renderVariableText,
    ...(options.recordIndex === undefined ? {} : { recordIndex: options.recordIndex }),
    ...(options.serialValue === undefined ? {} : { serialValue: options.serialValue }),
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
  });
  return emitPreparedGcode(prepared, options);
}
