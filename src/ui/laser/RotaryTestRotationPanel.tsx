// Test rotation controls inside Rotary Setup (ADR-373). They test the values
// on screen, before Apply, so the operator can adjust a measurement and turn
// the part again until one revolution lands back on the mark.

import {
  rotaryUsesRollerDiameter,
  type RotaryRevolutionTarget,
  type RotarySetup,
} from '../../core/devices/rotary';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { buttonRowStyle, hintStyle, panelStyle } from './rotary-setup-dialog.styles';
import { formatRotaryMm } from './rotary-summary';
import {
  planRotaryTestRotation,
  rotaryTestBlockReason,
  type RotaryTestOutcome,
  type RotaryTestPhase,
  type RotaryTestPlan,
} from './rotary-test-rotation';
import type { RotaryTestControls, RotaryTestView } from './use-rotary-test-rotation';

type TestTarget = { readonly target: RotaryRevolutionTarget; readonly label: string };

export function RotaryTestRotationPanel(props: {
  readonly setup: RotarySetup;
  readonly valid: boolean;
  readonly test: RotaryTestControls;
}): JSX.Element {
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const blockReason = useLaserStore((s) => rotaryTestBlockReason(s, machineKind));
  const { view } = props.test;
  const plans = rotaryTestTargets(props.setup).map((entry) => ({
    ...entry,
    plan: props.valid ? planRotaryTestRotation(props.setup, entry.target, maxFeed) : null,
  }));
  const testable = plans.some((entry) => entry.plan !== null);
  return (
    <section aria-label="Test rotation" style={panelStyle}>
      <strong>Test rotation</strong>
      <p style={hintStyle}>
        Turns one revolution slowly, pauses, then turns back. The laser stays off. Mark the part
        first; the mark should come back to the same place.
      </p>
      <div style={buttonRowStyle}>
        {view.kind === 'running' ? (
          <Button variant="danger" onClick={props.test.stop}>
            Stop rotation
          </Button>
        ) : (
          plans.map((entry) => (
            <Button
              key={entry.target}
              disabled={blockReason !== null || entry.plan === null}
              title={blockReason ?? undefined}
              onClick={() => {
                if (entry.plan !== null) props.test.start(entry.plan);
              }}
            >
              {entry.label}
            </Button>
          ))
        )}
      </div>
      <p role="status" style={hintStyle}>
        {rotaryTestStatusText(view, testable)}
      </p>
      {blockReason !== null && view.kind !== 'running' ? (
        <p style={hintStyle}>{blockReason}</p>
      ) : null}
    </section>
  );
}

// A chuck turns the part directly. A roller scaled from its diameter can be
// tested either way: one roller turn checks Motion per turn, one object turn
// checks the whole chain including the roller size.
function rotaryTestTargets(setup: RotarySetup): ReadonlyArray<TestTarget> {
  if (setup.type === 'chuck') return [{ target: 'drive', label: 'Turn chuck once' }];
  const object: TestTarget = { target: 'object', label: 'Turn object once' };
  return rotaryUsesRollerDiameter(setup)
    ? [{ target: 'drive', label: 'Turn roller once' }, object]
    : [object];
}

function rotaryTestStatusText(view: RotaryTestView, testable: boolean): string {
  if (view.kind === 'running') return runningText(view.plan, view.phase);
  if (view.kind === 'finished') return finishedText(view.outcome);
  if (!testable) return 'Enter measurements greater than zero to test the rotation.';
  return 'Tests the values above, before Apply.';
}

function runningText(plan: RotaryTestPlan, phase: RotaryTestPhase): string {
  if (phase === 'pausing') return 'One revolution done. Check the mark, then it turns back.';
  if (phase === 'returning') return 'Turning back to where it started.';
  return (
    `Turning one revolution: ${formatRotaryMm(plan.travelMm)} machine mm at ` +
    `${plan.feedMmPerMin} mm/min, about ${Math.ceil(plan.legSeconds)} s.`
  );
}

function finishedText(outcome: RotaryTestOutcome): string {
  if (outcome.kind === 'failed') return outcome.message;
  if (outcome.kind === 'stopped') return 'Stopped. Nothing more is sent.';
  return 'Done. If the mark did not come back to the same place, adjust the measurements and test again.';
}
