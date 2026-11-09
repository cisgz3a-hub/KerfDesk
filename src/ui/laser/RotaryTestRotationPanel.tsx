// Test rotation controls inside Rotary Setup (ADR-373). They test the values
// on screen, before Apply, so the operator can correct one and turn again. A
// finished turn names the value that turn can correct (ADR-373 Amendment 1).

import {
  rotaryUsesRollerDiameter,
  type DedicatedRotaryAxis,
  type RotaryRevolutionTarget,
  type RotarySetup,
} from '../../core/devices/rotary';
import { rotaryAxisUnitLabel } from '../../core/devices/rotary-axis';
import { AxisConfirmation, rotaryAxisTestBlockReason } from './RotaryAxisConfirmation';
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
  /** The operator saw a finished turn move the rotary on this axis (ADR-693). */
  readonly onConfirmAxis?: (axis: DedicatedRotaryAxis) => void;
}): JSX.Element {
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const controllerKind = useStore((s) => s.project.device.controllerKind);
  const storeBlock = useLaserStore((s) => rotaryTestBlockReason(s, machineKind));
  const blockReason = rotaryAxisTestBlockReason(props.setup, controllerKind) ?? storeBlock;
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
        {rotaryTestStatusText(view, testable, props.setup)}
      </p>
      <AxisConfirmation
        setup={props.setup}
        view={view}
        {...(props.onConfirmAxis === undefined ? {} : { onConfirm: props.onConfirmAxis })}
      />
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

function rotaryTestStatusText(view: RotaryTestView, testable: boolean, setup: RotarySetup): string {
  if (view.kind === 'running') return runningText(view.plan, view.phase);
  if (view.kind === 'finished') return finishedText(view.outcome, view.plan.target, setup);
  if (!testable) return 'Enter measurements greater than zero to test the rotation.';
  return 'Tests the values above, before Apply.';
}

function runningText(plan: RotaryTestPlan, phase: RotaryTestPhase): string {
  if (phase === 'pausing') return 'One revolution done. Check the mark, then it turns back.';
  if (phase === 'returning') return 'Turning back to where it started.';
  return (
    `Turning one revolution on ${plan.axis}: ${formatRotaryMm(plan.travelMm)} ` +
    `${rotaryAxisUnitLabel(plan.axis)} at ${plan.feedMmPerMin} ` +
    `${plan.axis === 'A' ? '°/min' : 'mm/min'}, about ${Math.ceil(plan.legSeconds)} s.`
  );
}

function finishedText(
  outcome: RotaryTestOutcome,
  target: RotaryRevolutionTarget,
  setup: RotarySetup,
): string {
  if (outcome.kind === 'failed') return outcome.message;
  if (outcome.kind === 'stopped') return 'Stopped. Nothing more is sent.';
  return `Done. ${missAdvice(target, setup)}`;
}

// What to change when one revolution misses the mark. A drive turn measures
// Motion per turn alone. A roller's burn size never depends on the object
// diameter (LightBurn: it "does not affect output"), so tuning it until an
// object turn lands would hide a wrong scale (ADR-373 Amendment 1).
function missAdvice(target: RotaryRevolutionTarget, setup: RotarySetup): string {
  if (target === 'drive' || setup.type === 'chuck') {
    const part = setup.type === 'chuck' ? 'chuck' : 'roller';
    return (
      `If the ${part} did not turn exactly once, change Motion per turn: lower it if the ` +
      `${part} turned too far, raise it if it stopped short.`
    );
  }
  if (rotaryUsesRollerDiameter(setup)) {
    return (
      'If the mark did not come back to the same place, check Motion per turn with Turn roller ' +
      'once first. If the roller turns exactly once, measure the roller diameter and the object ' +
      'again instead of adjusting either until the mark lands. The roller diameter sets the burn ' +
      'size; the object diameter only sets how much artwork fits in one turn.'
    );
  }
  return (
    "If the mark did not come back to the same place, the controller is not moving the part's " +
    'surface in millimetres, so jobs would burn at the wrong size. Turn on Scale Y from the ' +
    "roller diameter and enter the roller diameter and Motion per turn, or set the controller's " +
    "Y steps/mm to the part's surface. Changing the object diameter can make the mark land, but " +
    'it does not fix the size.'
  );
}
