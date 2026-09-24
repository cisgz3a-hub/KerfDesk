// Whole-list switches for the operations panel, after LightBurn's Cuts /
// Layers header menu: every Output switch on, off or inverted, the same for
// Show, and Sort cuts last. Each command is one undo step.
import { machineKindOf, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { SortCutsLastButton } from './SortCutsLastButton';

export function OperationListActions(): JSX.Element {
  return (
    <details className="lf-operation-bulk">
      <summary title="Turn output or visibility on or off for every operation, or sort cuts last">
        Actions for every operation
      </summary>
      <OperationListActionsBody />
    </details>
  );
}

function OperationListActionsBody(): JSX.Element {
  const layers = useStore((state) => state.project.scene.layers);
  const setOutput = useStore((state) => state.setEveryOperationOutput);
  const invertOutput = useStore((state) => state.invertEveryOperationOutput);
  const setVisible = useStore((state) => state.setEveryOperationVisible);
  const invertVisible = useStore((state) => state.invertEveryOperationVisible);
  const laser = useStore((state) => machineKindOf(state.project.machine) === 'laser');
  return (
    <div className="lf-operation-bulk__body">
      <SwitchRow
        label="Output"
        noun="output"
        on={countOf(layers, (layer) => layer.output)}
        total={layers.length}
        onLabel="Enable all"
        offLabel="Disable all"
        onAll={() => setOutput(true)}
        offAll={() => setOutput(false)}
        invert={invertOutput}
      />
      <SwitchRow
        label="Show"
        noun="visibility"
        on={countOf(layers, (layer) => layer.visible)}
        total={layers.length}
        onLabel="Show all"
        offLabel="Hide all"
        onAll={() => setVisible(true)}
        offAll={() => setVisible(false)}
        invert={invertVisible}
      />
      {laser ? (
        <div className="lf-operation-bulk__sort">
          <SortCutsLastButton className="lf-btn lf-btn--ghost" />
          <p className="lf-artwork-hint">
            Runs each Line cut after the work inside it, so a part cannot drop or shift before that
            work runs.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SwitchRow(props: {
  readonly label: string;
  readonly noun: string;
  readonly on: number;
  readonly total: number;
  readonly onLabel: string;
  readonly offLabel: string;
  readonly onAll: () => void;
  readonly offAll: () => void;
  readonly invert: () => void;
}): JSX.Element {
  return (
    <div
      className="lf-operation-bulk__row"
      role="group"
      aria-label={`${props.label} for every operation`}
    >
      <span className="lf-operation-bulk__label">
        {props.label}{' '}
        <small>
          {props.on} of {props.total} on
        </small>
      </span>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        disabled={props.on === props.total}
        title={`Turn ${props.label} on for every operation`}
        onClick={props.onAll}
      >
        {props.onLabel}
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        disabled={props.on === 0}
        title={`Turn ${props.label} off for every operation`}
        onClick={props.offAll}
      >
        {props.offLabel}
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        aria-label={`Invert ${props.noun} of every operation`}
        title={`Turn ${props.label} off where it is on and on where it is off`}
        onClick={props.invert}
      >
        Invert
      </button>
    </div>
  );
}

function countOf(layers: ReadonlyArray<Layer>, predicate: (layer: Layer) => boolean): number {
  return layers.filter(predicate).length;
}
