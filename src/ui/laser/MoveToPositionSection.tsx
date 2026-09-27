// MoveToPositionSection — typed Move-to and saved head positions (LightBurn gap
// LBG-M02, ADR-493). LightBurn's Move window takes absolute machine numbers;
// here the operator picks the frame they already read on screen: Canvas (the
// rulers and X/Y boxes, so it lands where an Absolute job burns that point) or
// From origin (work coordinates, the numbers in the job's G-code, which need
// no homing). Saved positions keep their frame and live in the machine profile,
// so they travel with the profile and the project. Every move goes through
// dispatchHeadMove: beam off, the jog pad's speed, the store's jog path.

import { useState } from 'react';
import { toSceneCoords } from '../../core/devices';
import type {
  DeviceProfile,
  SavedHeadPosition,
  SavedPositionFrame,
} from '../../core/devices/device-profile';
import { machineKindOf, type Vec2 } from '../../core/scene';
import { NumberField } from '../common/NumberField';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { CollapsibleRailSection } from './CollapsibleRailSection';
import { currentHeadPosition, dispatchHeadMove } from './head-move-dispatch';
import {
  defaultSavedPositionName,
  savedPositionsAfterDelete,
  savedPositionsAfterSave,
} from './saved-head-positions';

const FRAME_LABEL: Readonly<Record<SavedPositionFrame, string>> = {
  bed: 'Canvas',
  origin: 'From origin',
};
const FRAME_TITLE =
  'Canvas: the numbers on the rulers, where an Absolute job burns that point. From origin: millimetres from the work origin, the numbers in the job G-code; works without homing.';
const COORDINATE_LIMIT_MM = 100_000;

export function MoveToPositionSection({ disabled }: { readonly disabled: boolean }): JSX.Element {
  const startFrom = useStore((s) => s.jobPlacement.startFrom);
  const device = useStore((s) => s.project.device);
  const [frame, setFrame] = useState<SavedPositionFrame>(
    startFrom === 'absolute' ? 'bed' : 'origin',
  );
  const [x, setX] = useState(() => frameZero(frame, device).x);
  const [y, setY] = useState(() => frameZero(frame, device).y);
  // Untouched fields follow the frame's zero, so Go never lands on a corner the
  // operator did not type (canvas 0, 0 is the back of a front-origin bed).
  const changeFrame = (next: SavedPositionFrame): void => {
    const zero = frameZero(frame, device);
    if (x === zero.x && y === zero.y) {
      setX(frameZero(next, device).x);
      setY(frameZero(next, device).y);
    }
    setFrame(next);
  };
  const useCurrent = (): void => {
    const current = currentHeadPosition(frame);
    if (current === null) {
      useToastStore
        .getState()
        .pushToast('The head position is not known yet. Wait for a status report.', 'error');
      return;
    }
    setX(current.xMm);
    setY(current.yMm);
  };
  return (
    <CollapsibleRailSection
      label="Move to position"
      title="Type a position or pick a saved one. The head moves there with the beam off."
    >
      <div style={rowStyle}>
        <label style={fieldStyle}>
          Coordinates
          <select
            aria-label="Move-to coordinates"
            title={FRAME_TITLE}
            value={frame}
            onChange={(event) => changeFrame(event.target.value as SavedPositionFrame)}
          >
            <option value="bed">{FRAME_LABEL.bed}</option>
            <option value="origin">{FRAME_LABEL.origin}</option>
          </select>
        </label>
        <CoordinateField axis="X" value={x} onCommit={setX} />
        <CoordinateField axis="Y" value={y} onCommit={setY} />
      </div>
      <div style={actionsStyle}>
        <button
          type="button"
          className="lf-btn"
          disabled={disabled}
          title="Move the head, beam off, to the typed position."
          onClick={() => dispatchHeadMove({ frame, xMm: x, yMm: y }, `X${x} Y${y}`)}
        >
          Go
        </button>
        <button
          type="button"
          className="lf-btn"
          title="Fill X and Y with where the head is now."
          onClick={useCurrent}
        >
          Use current
        </button>
        <SetFinishButton frame={frame} x={x} y={y} />
      </div>
      <SavedPositions disabled={disabled} draft={{ frame, xMm: x, yMm: y }} />
    </CollapsibleRailSection>
  );
}

// Where untouched X and Y start: machine X0 Y0 in canvas numbers, or work zero.
function frameZero(frame: SavedPositionFrame, device: DeviceProfile): Vec2 {
  return frame === 'bed' ? toSceneCoords({ x: 0, y: 0 }, device) : { x: 0, y: 0 };
}

// LightBurn's Set Finish Position (ADR-493): laser jobs end at this canvas
// point. The finish is stored in canvas coordinates, so a From origin position,
// whose place on the bed depends on the current work offset, cannot be used.
function SetFinishButton(props: {
  readonly frame: SavedPositionFrame;
  readonly x: number;
  readonly y: number;
}): JSX.Element | null {
  const laser = useStore((s) => machineKindOf(s.project.machine) === 'laser');
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  if (!laser) return null;
  const onSet = (): void => {
    updateDeviceProfile({ laserFinishPosition: { kind: 'bed', xMm: props.x, yMm: props.y } });
    useToastStore
      .getState()
      .pushToast(`Laser jobs now finish at canvas X${props.x} Y${props.y}.`, 'success');
  };
  return (
    <button
      type="button"
      className="lf-btn"
      disabled={props.frame !== 'bed'}
      title={
        props.frame === 'bed'
          ? 'End every laser job at this canvas position (Machine Setup, After a job).'
          : 'Switch Coordinates to Canvas: the finish position is a canvas position.'
      }
      onClick={onSet}
    >
      Finish jobs here
    </button>
  );
}

function CoordinateField(props: {
  readonly axis: 'X' | 'Y';
  readonly value: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.axis} mm
      <NumberField
        ariaLabel={`Move-to ${props.axis}`}
        value={props.value}
        min={-COORDINATE_LIMIT_MM}
        max={COORDINATE_LIMIT_MM}
        step={0.1}
        debounceMs={0}
        onCommit={props.onCommit}
      />
    </label>
  );
}

function SavedPositions(props: {
  readonly disabled: boolean;
  readonly draft: Omit<SavedHeadPosition, 'name'>;
}): JSX.Element {
  const saved = useStore((s) => s.project.device.savedPositions ?? []);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const [name, setName] = useState('');
  const save = (): void => {
    updateDeviceProfile({ savedPositions: savedPositionsAfterSave(saved, name, props.draft) });
    setName('');
  };
  return (
    <div style={savedStyle}>
      <div style={actionsStyle}>
        <input
          type="text"
          aria-label="Saved position name"
          title="Name for the saved position. Saving under an existing name replaces it."
          placeholder={defaultSavedPositionName(saved)}
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="lf-btn"
          title="Save the typed position under this name, in the chosen coordinates. The same name replaces the old one."
          onClick={save}
        >
          Save
        </button>
      </div>
      {saved.length === 0 ? null : (
        <ul aria-label="Saved positions" style={listStyle}>
          {saved.map((position) => (
            <SavedPositionRow
              key={position.name}
              position={position}
              disabled={props.disabled}
              onDelete={() =>
                updateDeviceProfile({
                  savedPositions: savedPositionsAfterDelete(saved, position.name),
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedPositionRow(props: {
  readonly position: SavedHeadPosition;
  readonly disabled: boolean;
  readonly onDelete: () => void;
}): JSX.Element {
  const { position } = props;
  const where = `X${position.xMm} Y${position.yMm} (${FRAME_LABEL[position.frame]})`;
  return (
    <li style={savedRowStyle}>
      <span style={savedNameStyle} title={where}>
        <strong>{position.name}</strong> {where}
      </span>
      <button
        type="button"
        className="lf-btn"
        disabled={props.disabled}
        aria-label={`Go to ${position.name}`}
        title={`Move the head, beam off, to ${position.name}.`}
        onClick={() => dispatchHeadMove(position, position.name)}
      >
        Go
      </button>
      <button
        type="button"
        className="lf-btn"
        aria-label={`Delete ${position.name}`}
        title={`Delete the saved position ${position.name}.`}
        onClick={props.onDelete}
      >
        Delete
      </button>
    </li>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)',
  alignItems: 'flex-end',
  gap: 6,
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 'var(--lf-text-sm)',
  minWidth: 0,
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  marginTop: 6,
};
const savedStyle: React.CSSProperties = { marginTop: 4 };
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '6px 0 0',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const savedRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
  alignItems: 'center',
  gap: 6,
};
const savedNameStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
