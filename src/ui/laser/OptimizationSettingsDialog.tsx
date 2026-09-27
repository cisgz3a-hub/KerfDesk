import { useState } from 'react';
import type { ProjectOptimizationSettings } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';

export function OptimizationSettingsDialog(props: {
  readonly settings: ProjectOptimizationSettings;
  readonly onCancel: () => void;
  readonly onApply: (patch: ProjectOptimizationSettings) => void;
}): JSX.Element {
  const [settings, setSettings] = useState(props.settings);
  const update = (patch: Partial<ProjectOptimizationSettings>): void =>
    setSettings((current) => ({ ...current, ...patch }));
  return (
    <Dialog
      onClose={props.onCancel}
      title="Cut Planner"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply({
          ...settings,
          reduceTravelMoves: settings.travelPolicy === 'nearest-neighbor',
        });
      }}
      size="sm"
    >
      <PlannerFields settings={settings} update={update} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PlannerFields(props: {
  readonly settings: ProjectOptimizationSettings;
  readonly update: (patch: Partial<ProjectOptimizationSettings>) => void;
}): JSX.Element {
  const { settings, update } = props;
  const keepsSourceOrder = settings.travelPolicy === 'source-order';
  const orderingControlTitle = keepsSourceOrder
    ? 'Keep source order bypasses this setting. Switch Travel policy to Reduce travel to use it.'
    : undefined;
  // Keep source order still moves closed-shape starts, from Planning start.
  const choosesClosedStarts = settings.closedShapeStart !== 'drawn';
  const startPointTitle = choosesClosedStarts ? undefined : orderingControlTitle;
  return (
    <>
      <PlannerSelect
        label="Travel policy"
        name="travelPolicy"
        value={settings.travelPolicy}
        onChange={(travelPolicy) =>
          update({ travelPolicy: travelPolicy as ProjectOptimizationSettings['travelPolicy'] })
        }
        options={[
          ['nearest-neighbor', 'Reduce travel'],
          ['source-order', 'Keep source order'],
        ]}
      />
      <InsideFirstField
        checked={settings.insideFirst}
        disabled={keepsSourceOrder}
        title={orderingControlTitle ?? 'Cut enclosed paths before their containing paths.'}
        update={update}
      />
      <OverlapRemovalField checked={settings.removeOverlappingLines} update={update} />
      <PlannerSelect
        label="Layer priority"
        name="layerPriority"
        value={settings.layerPriority}
        onChange={(layerPriority) =>
          update({ layerPriority: layerPriority as ProjectOptimizationSettings['layerPriority'] })
        }
        options={[
          ['project-order', 'Cuts / Layers order'],
          ['reverse-project-order', 'Reverse layer order'],
        ]}
      />
      <PlannerSelect
        label="Path direction"
        name="pathDirection"
        value={settings.pathDirection}
        disabled={keepsSourceOrder}
        {...(orderingControlTitle === undefined ? {} : { title: orderingControlTitle })}
        onChange={(pathDirection) =>
          update({ pathDirection: pathDirection as ProjectOptimizationSettings['pathDirection'] })
        }
        options={[
          ['allow-reverse', 'Choose nearest endpoint'],
          ['preserve', 'Preserve direction'],
        ]}
      />
      <PlannerSelect
        label="Planning start"
        name="startPoint"
        value={settings.startPoint}
        disabled={keepsSourceOrder && !choosesClosedStarts}
        {...(startPointTitle === undefined ? {} : { title: startPointTitle })}
        onChange={(startPoint) =>
          update({ startPoint: startPoint as ProjectOptimizationSettings['startPoint'] })
        }
        options={[
          ['machine-origin', 'Machine origin'],
          ['job-lower-left', 'Job lower-left'],
          ['job-center', 'Job center'],
        ]}
      />
      <ClosedShapeStartField value={settings.closedShapeStart} update={update} />
      {keepsSourceOrder ? (
        <SourceOrderPrecedenceNote choosesClosedStarts={choosesClosedStarts} />
      ) : null}
    </>
  );
}

// LBG-C04. The dialog is laser-only: its command is hidden in CNC mode
// (LASER_ONLY_COMMAND_IDS), and optimizePaths never reorders CNC groups.
function ClosedShapeStartField(props: {
  readonly value: ProjectOptimizationSettings['closedShapeStart'];
  readonly update: (patch: Partial<ProjectOptimizationSettings>) => void;
}): JSX.Element {
  return (
    <PlannerSelect
      label="Start closed shapes"
      name="closedShapeStart"
      value={props.value}
      title="Choose where each closed shape starts and stops cutting."
      onChange={(closedShapeStart) =>
        props.update({
          closedShapeStart: closedShapeStart as ProjectOptimizationSettings['closedShapeStart'],
        })
      }
      options={[
        ['drawn', 'Where drawn', 'Start each closed shape at the point where it was drawn.'],
        [
          'nearest',
          'Nearest point',
          'Start each closed shape at the point nearest the head, to shorten travel.',
        ],
        [
          'nearest-corner',
          'Nearest corner',
          'Start each closed shape at the corner nearest the head, so the start and stop mark lands on a corner. Shapes without corners start at the nearest point.',
        ],
      ]}
    />
  );
}

function InsideFirstField(props: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly title: string;
  readonly update: (patch: Partial<ProjectOptimizationSettings>) => void;
}): JSX.Element {
  return (
    <label style={checkboxRowStyle}>
      <input
        name="insideFirst"
        type="checkbox"
        className="lf-checkbox"
        checked={props.checked}
        disabled={props.disabled}
        title={props.title}
        onChange={(event) => props.update({ insideFirst: event.currentTarget.checked })}
      />
      <span>Inside paths first</span>
    </label>
  );
}

function OverlapRemovalField(props: {
  readonly checked: boolean;
  readonly update: (patch: Partial<ProjectOptimizationSettings>) => void;
}): JSX.Element {
  return (
    <label style={checkboxRowStyle}>
      <input
        name="removeOverlappingLines"
        type="checkbox"
        className="lf-checkbox"
        checked={props.checked}
        title="Cut shared Line spans once within each operation. Separate operations and pass counts are preserved."
        onChange={(event) => props.update({ removeOverlappingLines: event.currentTarget.checked })}
      />
      <span>Remove overlapping lines</span>
    </label>
  );
}

function SourceOrderPrecedenceNote(props: { readonly choosesClosedStarts: boolean }): JSX.Element {
  if (props.choosesClosedStarts) {
    return (
      <p style={precedenceNoteStyle} role="status">
        Keep source order preserves path sequence and direction inside each operation. Inside paths
        first and Path direction are saved but bypassed. Start closed shapes still applies,
        beginning from Planning start. Layer priority still applies. Overlap removal, when enabled,
        also applies.
      </p>
    );
  }
  return (
    <p style={precedenceNoteStyle} role="status">
      Keep source order preserves path sequence and direction inside each operation. Inside paths
      first, Path direction, and Planning start are saved but bypassed. Layer priority still
      applies. Overlap removal, when enabled, also applies.
    </p>
  );
}

function PlannerSelect(props: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<readonly [value: string, label: string, title?: string]>;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly title?: string;
}): JSX.Element {
  return (
    <label style={selectRowStyle}>
      <span>{props.label}</span>
      <select
        name={props.name}
        value={props.value}
        disabled={props.disabled === true}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        title={props.title ?? `Choose ${props.label.toLowerCase()}.`}
      >
        {props.options.map(([value, label, title]) => (
          <option key={value} value={value} {...(title === undefined ? {} : { title })}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const selectRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(110px, 1fr) minmax(150px, 1.4fr)',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};

const precedenceNoteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.4,
};
