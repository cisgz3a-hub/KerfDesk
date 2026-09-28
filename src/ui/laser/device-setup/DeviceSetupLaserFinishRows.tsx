// "After a job" for laser output (LightBurn gap LBG-M02, ADR-493). The default
// is no stored value, so a profile that never touches this keeps today's
// output. A bed position is typed in canvas coordinates, the numbers the rulers
// show, like every other head position in the app; preparation places it on
// the job the way the CNC park is placed (ADR-392).

import { resolveGrblDialect, toSceneCoords, type DeviceProfile } from '../../../core/devices';
import type { LaserFinishPosition } from '../../../core/devices/device-profile';
import { NumberField } from '../../common/NumberField';
import { Row, numInputStyle, unitStyle } from '../device-settings-shared';

type FinishChoice = 'origin' | LaserFinishPosition['kind'];

export function DeviceSetupLaserFinishRows(props: {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const { device, update } = props;
  const finish = device.laserFinishPosition;
  const choice: FinishChoice = finish?.kind ?? 'origin';
  const parksAtOrigin = resolveGrblDialect(device).parkAtOriginAfterJob;
  const choose = (next: string): void => {
    if (next === 'stay') update({ laserFinishPosition: { kind: 'stay' } });
    else if (next === 'bed') update({ laserFinishPosition: machineZeroFinish(device) });
    else update({ laserFinishPosition: undefined });
  };
  return (
    <div style={stackStyle}>
      <Row label="After a job">
        <select
          value={choice}
          onChange={(event) => choose(event.target.value)}
          aria-label="After a job"
          title="Where the laser head goes when a job ends."
        >
          <option value="origin">
            {parksAtOrigin ? 'Go to the work origin' : 'Dialect default: stay where it ends'}
          </option>
          <option value="stay">Stay where the job ends</option>
          <option value="bed">Go to a bed position</option>
        </select>
      </Row>
      {finish?.kind === 'bed' ? (
        <>
          <CanvasNumberRow
            label="X on the canvas"
            value={finish.xMm}
            max={device.bedWidth}
            onCommit={(xMm) => update({ laserFinishPosition: { ...finish, xMm } })}
          />
          <CanvasNumberRow
            label="Y on the canvas"
            value={finish.yMm}
            max={device.bedHeight}
            onCommit={(yMm) => update({ laserFinishPosition: { ...finish, yMm } })}
          />
        </>
      ) : null}
      <p className="lf-setup-muted" style={hintStyle}>
        {FINISH_HINTS[choice]}
      </p>
    </div>
  );
}

// A new bed finish starts on machine X0 Y0, LightBurn's default finish, shown in
// canvas numbers: on a front-left machine that is the front-left corner, canvas
// (0, bed height), not the canvas origin at the back.
function machineZeroFinish(device: DeviceProfile): LaserFinishPosition {
  const scene = toSceneCoords({ x: 0, y: 0 }, device);
  return { kind: 'bed', xMm: scene.x, yMm: scene.y };
}

/** The review page's one-line summary of the choice above. */
export function laserFinishSummary(device: DeviceProfile): string {
  const finish = device.laserFinishPosition;
  if (finish?.kind === 'stay') return 'Stay where the job ends';
  if (finish?.kind === 'bed') return `Canvas X ${finish.xMm}, Y ${finish.yMm} mm`;
  return resolveGrblDialect(device).parkAtOriginAfterJob
    ? 'Work origin (Current Position: back to the start)'
    : 'Dialect default (Current Position: back to the start)';
}

const FINISH_HINTS: Readonly<Record<FinishChoice, string>> = {
  origin: 'A Current Position job goes back to where it started.',
  stay: 'The head stays where the last burn ended, with the laser off. A Current Position job does not go back to its start either, so the next Start begins there.',
  bed:
    'Canvas coordinates, as on the rulers. If the job’s place on the bed is unknown ' +
    '(no verified bed mapping) or the rotary is on, the head goes to the work origin instead. ' +
    'A Current Position job ends here too, so the next Start begins here.',
};

function CanvasNumberRow(props: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <NumberField
        min={0}
        max={props.max}
        step={1}
        value={props.value}
        onCommit={props.onCommit}
        style={numInputStyle}
        ariaLabel={props.label}
        title={props.label}
        debounceMs={0}
      />
      <span style={unitStyle}>mm</span>
    </Row>
  );
}

const stackStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const hintStyle: React.CSSProperties = { margin: 0 };
