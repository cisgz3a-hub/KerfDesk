// emitGcode — runs the Phase A pipeline (compile → emit → preflight) over a
// Project and returns the G-code string plus the preflight verdict. Pure: no
// I/O. The UI / platform adapter decides whether to actually write the file
// based on `preflight.ok`.

import {
  runCncPreflight,
  runPreflight,
  type PreflightOptions,
  type PreflightResult,
} from '../../core/preflight';
import type { JobOriginPlacement } from '../../core/job';
import { cncGrblStrategy, grblStrategy } from '../../core/output';
import type { OutputScope, Project } from '../../core/scene';
import { gcodeMetadataHeader, type GcodeMetadata } from './gcode-metadata';
import { prepareOutput } from './prepare-output';

export type EmitGcodeResult = {
  readonly gcode: string;
  readonly preflight: PreflightResult;
};

export type EmitGcodeOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  // When set, a provenance comment header (build/commit/emitter) is prepended to
  // the returned G-code. Preflight runs on the motion body only, so the header
  // never affects the verdict, and callers that need deterministic, header-free
  // output (tests, preview) simply omit it.
  readonly metadata?: GcodeMetadata;
};

export function emitGcode(project: Project, options: EmitGcodeOptions = {}): EmitGcodeResult {
  // Compile / place / optimize + the pre-emit budget guard all live in
  // prepareOutput — the SAME pipeline the canvas preview and live estimate use,
  // so what is previewed is what is emitted (roadmap P1-C). A budget failure
  // short-circuits here with empty g-code + the failing preflight (the UI shows
  // the reason instead of freezing, roadmap P1-A).
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin ? { jobOrigin: options.jobOrigin } : {}),
    ...(options.outputScope ? { outputScope: options.outputScope } : {}),
  });
  if (!prepared.ok) return { gcode: '', preflight: prepared.preflight };
  const machine = prepared.project.machine;
  const isCncMachine = machine !== undefined && machine.kind === 'cnc';
  const body = isCncMachine
    ? cncGrblStrategy.emit(prepared.job, prepared.project.device)
    : grblStrategy.emit(prepared.job, prepared.project.device);
  // Preflight the motion body, NOT the header — the provenance comments are
  // inert to every invariant (all strip comments) but keeping them out of the
  // preflight input makes that guarantee explicit.
  const coordinateMode =
    options.jobOrigin !== undefined && options.preflightMotionOffset === undefined
      ? 'relative-origin'
      : 'machine';
  const preflight =
    machine !== undefined && machine.kind === 'cnc'
      ? runCncPreflight(prepared.project, machine, body, {
          motionOffset: options.preflightMotionOffset,
        })
      : runPreflight(prepared.project, body, {
          motionOffset: options.preflightMotionOffset,
          coordinateMode,
        });
  const gcode = options.metadata
    ? gcodeMetadataHeader(options.metadata, { maxPowerS: prepared.project.device.maxPowerS }) + body
    : body;
  return { gcode, preflight };
}
