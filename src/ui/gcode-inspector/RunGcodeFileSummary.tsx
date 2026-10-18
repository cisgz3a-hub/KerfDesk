// RunGcodeFileSummary — what the Run dialog reviews before Start (ADR-630):
// what is sent, how long it should take, the outline the Frame traces, its
// units and machine mode, and the warnings. Display only.

import type { ExternalProgramUnits } from '../../core/external-program';
import type { MachineKind } from '../../core/scene';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { PreparedExternalRun } from './prepare-external-run';

const UNITS_TEXT: Readonly<Record<ExternalProgramUnits, string>> = {
  mm: 'millimetres (G21)',
  inch: 'inches (G20)',
  both: 'millimetres and inches (G21 and G20)',
  undeclared: 'not declared; the controller keeps its current units, usually millimetres',
};

export function RunGcodeFileSummary(props: {
  readonly prepared: Extract<PreparedExternalRun, { readonly kind: 'ready' }>;
  readonly analysis: GcodeInspectorAnalysis;
  readonly machineKind: MachineKind;
  readonly formatLength: (mm: number) => string;
  readonly formatSeconds: (seconds: number) => string;
}): JSX.Element {
  const { program, review, run } = props.prepared;
  const { envelope } = run;
  const dropped =
    program.droppedLineCount > 0 || program.commentsRemoved
      ? ' Comments, % markers and blank lines are left out; nothing else is changed.'
      : '';
  return (
    <div className="lf-run-gcode-summary">
      <dl>
        <dt>Sends</dt>
        <dd>
          {program.lineCount} lines, {program.byteCount} bytes.{dropped}
        </dd>
        <dt>Estimated time</dt>
        <dd>
          {props.formatSeconds(props.analysis.time.totalSeconds)}
          {props.analysis.timedFor === null
            ? ' (stock GRBL limits)'
            : ` (${props.analysis.timedFor})`}
        </dd>
        <dt>Frame outline</dt>
        <dd>
          {props.formatLength(envelope.maxX - envelope.minX)} ×{' '}
          {props.formatLength(envelope.maxY - envelope.minY)}; lowest corner X{' '}
          {props.formatLength(envelope.minX)}, Y {props.formatLength(envelope.minY)} (work
          coordinates, travel moves included)
        </dd>
        <dt>Units</dt>
        <dd>{UNITS_TEXT[review.units]}</dd>
        <dt>Runs as</dt>
        <dd>{props.machineKind === 'cnc' ? 'a CNC job' : 'a laser job'}</dd>
      </dl>
      {review.warnings.length === 0 ? null : (
        <section aria-label="Warnings">
          <h3 className="lf-run-gcode-warnings-title">Warnings ({review.warnings.length})</h3>
          <ul>
            {review.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
