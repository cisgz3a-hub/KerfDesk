// RunGcodeFileSummary — what the Run dialog reviews before Start (ADR-630):
// what is sent, how long it should take, the outline the Frame traces, its
// units and machine mode, and the warnings. Display only.

import { BASELINE_WORD_MEANINGS, type ExternalProgramUnits } from '../../core/external-program';
import type { MachineKind } from '../../core/scene';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { PreparedExternalRun } from './prepare-external-run';

const UNITS_TEXT: Readonly<Record<ExternalProgramUnits, string>> = {
  mm: 'millimetres (G21)',
  inch: 'inches (G20)',
  both: 'millimetres and inches (G21 and G20)',
  undeclared: 'not declared; the G21 sent first sets millimetres',
};

export function RunGcodeFileSummary(props: {
  readonly prepared: Extract<PreparedExternalRun, { readonly kind: 'ready' }>;
  readonly analysis: GcodeInspectorAnalysis;
  readonly machineKind: MachineKind;
  /** False until the machine reports the head position the outline starts from. */
  readonly startKnown: boolean;
  /** The controller's $30/$32 findings and lit rapids (external-run-readiness.ts). */
  readonly controllerWarnings: ReadonlyArray<string>;
  /** Where the outline lands on the bed (external-run-bed.ts). */
  readonly bedWarnings: ReadonlyArray<string>;
  readonly formatLength: (mm: number) => string;
  readonly formatSeconds: (seconds: number) => string;
}): JSX.Element {
  const { program, review, run } = props.prepared;
  const { envelope, start } = run;
  const warnings = [...props.controllerWarnings, ...review.warnings, ...props.bedWarnings];
  return (
    <div className="lf-run-gcode-summary">
      <dl>
        <dt>Sends</dt>
        <dd>
          {program.lineCount} lines, {program.byteCount} bytes: {baselineText(program.baseline)}{' '}
          {program.controllerKind === 'marlin'
            ? 'first on separate lines, then the program with comments, % markers, blank lines and outer whitespace removed and LF line endings. Spacing inside each line and command order are preserved; Marlin executes the first command on each line.'
            : 'first, the modes the review reads the program in, then each line as GRBL itself reads it, with comments, spaces, tabs and other control characters it discards, / marks, % markers and blank lines left out and LF line endings. Nothing else is changed.'}
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
        <dt>Starts from</dt>
        <dd>
          {props.startKnown
            ? `where the head stands: X ${props.formatLength(start.x)}, Y ${props.formatLength(start.y)}. The Frame returns there.`
            : 'the work origin until the connected machine reports where the head is'}
        </dd>
        <dt>Units</dt>
        <dd>{UNITS_TEXT[review.units]}</dd>
        <dt>Runs as</dt>
        <dd>{props.machineKind === 'cnc' ? 'a CNC job' : 'a laser job'}</dd>
      </dl>
      {warnings.length === 0 ? null : (
        <section aria-label="Warnings">
          <h3 className="lf-run-gcode-warnings-title">Warnings ({warnings.length})</h3>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// "G21 G90 (millimetres, absolute moves)" from the baseline line `G21G90`.
function baselineText(baseline: string): string {
  const words = baseline.match(/[A-Z][0-9.]+/g) ?? [];
  const meanings = words.flatMap((word) => {
    const meaning = BASELINE_WORD_MEANINGS[word];
    return meaning === undefined ? [] : [meaning];
  });
  return `${words.join(' ')} (${meanings.join(', ')})`;
}
