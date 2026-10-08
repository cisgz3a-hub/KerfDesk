import type { CncMachiningSetup } from '../../../core/scene/cnc-machining-setup';
import type { CncStock } from '../../../core/scene/machine';
import type { CncTwoSidedSetup } from '../../../core/scene/cnc-two-sided-setup';
import type { SceneObject } from '../../../core/scene/scene-object';
import { useStore } from '../../state';
import {
  DeviceSetupCncSidePreviews,
  DeviceSetupCncSideRegistration,
} from './DeviceSetupCncSideRegistration';

export function DeviceSetupCncSides(props: {
  readonly setup: CncMachiningSetup;
  readonly stock: CncStock;
  readonly onChange: (setup: CncMachiningSetup) => void;
}): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  const side = props.setup.twoSided;
  const edit = (next: CncTwoSidedSetup): void => props.onChange({ ...props.setup, twoSided: next });
  const setEnabled = (enabled: boolean): void => {
    if (enabled)
      edit({
        activeSide: 'A',
        flipAxis: 'y',
        sideBStockOriginMm: props.stock.originOffset,
        sideAObjectIds: objects.map((object) => object.id),
        sideBObjectIds: [],
        registration: [],
      });
    else {
      const { twoSided: _side, ...single } = props.setup;
      props.onChange(single);
    }
  };
  return (
    <details>
      <summary title="Configure side assignments, stock flipping and registration guides">
        Two-sided machining {side === undefined ? '· Off' : '· Side ' + side.activeSide}
      </summary>
      <label>
        <input
          title="Enable separate side A and side B machining setup"
          type="checkbox"
          aria-label="Enable two-sided CNC setup"
          checked={side !== undefined}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Use two sides
      </label>
      {side === undefined ? null : (
        <SideDraftEditor side={side} stock={props.stock} objects={objects} onChange={edit} />
      )}
    </details>
  );
}

function SideDraftEditor(props: {
  readonly side: CncTwoSidedSetup;
  readonly stock: CncStock;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly onChange: (side: CncTwoSidedSetup) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p>
        Assign artwork to each side. Side A uses the stock origin above; Side B uses its own G54
        datum. Set Z0 on the top of each side. Registration circles are setup guides.
      </p>
      <SideAxesFields side={props.side} onChange={props.onChange} />
      <SideOriginFields side={props.side} onChange={props.onChange} />
      <SideArtworkAssignments side={props.side} objects={props.objects} onChange={props.onChange} />
      <DeviceSetupCncSideRegistration
        side={props.side}
        stock={props.stock}
        onChange={props.onChange}
      />
      <DeviceSetupCncSidePreviews stock={props.stock} side={props.side} />
      <p>
        Save applies the reviewed side configuration in one undo step. Export and Frame prepare the
        active side. Physical flip accuracy is measured separately.
      </p>
    </div>
  );
}

function SideAxesFields(props: {
  readonly side: CncTwoSidedSetup;
  readonly onChange: (side: CncTwoSidedSetup) => void;
}): JSX.Element {
  const { side, onChange } = props;
  return (
    <>
      <label>
        Active side{' '}
        <select
          title="Choose which side is prepared for preview and output"
          aria-label="Active CNC side"
          value={side.activeSide}
          onChange={(event) =>
            onChange({ ...side, activeSide: event.target.value === 'A' ? 'A' : 'B' })
          }
        >
          <option>A</option>
          <option>B</option>
        </select>
      </label>
      <label>
        Flip around{' '}
        <select
          title="Choose the physical stock axis used for the side B flip"
          aria-label="CNC stock flip axis"
          value={side.flipAxis}
          onChange={(event) =>
            onChange({ ...side, flipAxis: event.target.value === 'x' ? 'x' : 'y' })
          }
        >
          <option value="x">Stock X axis · mirror Y</option>
          <option value="y">Stock Y axis · mirror X</option>
        </select>
      </label>
    </>
  );
}

function SideOriginFields(props: {
  readonly side: CncTwoSidedSetup;
  readonly onChange: (side: CncTwoSidedSetup) => void;
}): JSX.Element {
  const { side, onChange } = props;
  return (
    <>
      {(['x', 'y'] as const).map((axis) => (
        <label key={axis}>
          Side B stock origin {axis.toUpperCase()} mm{' '}
          <input
            title={'Side B stock origin ' + axis.toUpperCase() + ' in machine millimetres'}
            type="number"
            aria-label={'Side B stock origin ' + axis.toUpperCase()}
            value={side.sideBStockOriginMm[axis]}
            onChange={(event) =>
              onChange({
                ...side,
                sideBStockOriginMm: {
                  ...side.sideBStockOriginMm,
                  [axis]: event.target.valueAsNumber,
                },
              })
            }
          />
        </label>
      ))}
    </>
  );
}

function SideArtworkAssignments(props: {
  readonly side: CncTwoSidedSetup;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly onChange: (side: CncTwoSidedSetup) => void;
}): JSX.Element {
  const { side, objects, onChange } = props;
  return (
    <fieldset>
      <legend>Artwork on each side</legend>
      {objects.map((object) => (
        <div key={object.id}>
          <span>{object.name ?? object.id}</span>
          {(['A', 'B'] as const).map((which) => {
            const key = which === 'A' ? 'sideAObjectIds' : 'sideBObjectIds';
            const ids = side[key];
            return (
              <label key={which}>
                <input
                  title={'Include artwork ' + object.id + ' on side ' + which}
                  type="checkbox"
                  aria-label={object.id + ' on side ' + which}
                  checked={ids.includes(object.id)}
                  onChange={(event) =>
                    onChange({
                      ...side,
                      [key]: event.target.checked
                        ? [...ids, object.id]
                        : ids.filter((id) => id !== object.id),
                    })
                  }
                />
                {which}
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}
