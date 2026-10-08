import { useDeferredValue, useMemo, useState } from 'react';
import type { ImportedSvg, Project } from '../../core/scene';
import {
  compoundPreviewObject,
  evaluateBooleanCompound,
} from '../../core/geometry/boolean-compound';
import {
  type BooleanCompound,
  type BooleanCompoundOperation,
} from '../../core/scene/boolean-compound';
import { useStore } from '../state';
import { Button, Dialog, DialogActions } from '../kit';
import { BooleanCompoundOperandFields } from './BooleanCompoundOperandFields';
import { VectorComparisonPreview } from './VectorComparisonPreview';

type Props = {
  readonly object: ImportedSvg & { readonly booleanCompound: BooleanCompound };
  readonly project: Project;
  readonly epoch: number;
  readonly close: () => void;
};
export function BooleanCompoundEditor(props: Props): JSX.Element {
  const [compound, setCompound] = useState(props.object.booleanCompound);
  const [index, setIndex] = useState(0);
  const deferredCompound = useDeferredValue(compound);
  const currentProject = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const current = currentProject === props.project && epoch === props.epoch;
  const preview = useMemo(
    () => evaluateBooleanCompound(compoundPreviewObject(props.object), deferredCompound),
    [props.object, deferredCompound],
  );
  const apply = (): void =>
    applyCompoundEdits(
      props,
      compound,
      current &&
        deferredCompound === compound &&
        compound !== props.object.booleanCompound &&
        preview.kind === 'ok',
    );
  return (
    <Dialog
      title="Edit Compound Sources"
      size="lg"
      as="form"
      onClose={props.close}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <CompoundOperationField
        operation={compound.operation}
        change={(operation) => setCompound({ ...compound, operation })}
      />
      <VectorComparisonPreview
        before={compound.operands.map((item) => item.object)}
        after={preview.kind === 'ok' ? [preview.value] : []}
        label="Live compound sources and result"
      />
      <CompoundSourceEditor
        compound={compound}
        index={index}
        setIndex={setIndex}
        setCompound={setCompound}
      />
      <p role="status" aria-live="polite">
        {!current
          ? 'The project changed. Close and reopen this editor.'
          : deferredCompound !== compound
            ? 'Updating compound preview…'
            : preview.kind === 'error'
              ? preview.error.message
              : 'Source edits reevaluate the result. Apply saves one undo step; Cancel discards these edits.'}
      </p>
      <DialogActions>
        <Button onClick={props.close}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={
            !current ||
            deferredCompound !== compound ||
            compound === props.object.booleanCompound ||
            preview.kind !== 'ok'
          }
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function CompoundOperationField(props: {
  readonly operation: BooleanCompoundOperation;
  readonly change: (value: BooleanCompoundOperation) => void;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span>Operation</span>
      <select
        className="lf-input"
        aria-label="Compound operation"
        title="Subtract uses the first retained source as its subject. Weld preserves retained operation partitions."
        value={props.operation}
        onChange={(event) => props.change(event.currentTarget.value as BooleanCompoundOperation)}
      >
        <option value="weld" disabled={props.operation !== 'weld'}>
          Weld within each operation
        </option>
        <option value="subtract" disabled={props.operation === 'weld'}>
          Subtract
        </option>
        <option value="intersect" disabled={props.operation === 'weld'}>
          Intersect
        </option>
        <option value="exclude" disabled={props.operation === 'weld'}>
          Exclude
        </option>
      </select>
    </label>
  );
}
function SourceReorder(props: {
  readonly index: number;
  readonly count: number;
  readonly move: (delta: number) => void;
}): JSX.Element {
  return (
    <div>
      <p>
        The first retained source is the Subtract subject. Reordering sources leaves canvas and
        manufacturing order unchanged.
      </p>
      <Button
        disabled={props.index === 0}
        onClick={() => props.move(-1)}
        title="Move this retained source earlier; the first is the subtraction subject."
      >
        Earlier source
      </Button>
      <Button
        disabled={props.index === props.count - 1}
        onClick={() => props.move(1)}
        title="Move this retained source later without changing output order."
      >
        Later source
      </Button>
    </div>
  );
}

function applyCompoundEdits(props: Props, compound: BooleanCompound, valid: boolean): void {
  const state = useStore.getState();
  if (!valid || state.project !== props.project || state.projectDocumentEpoch !== props.epoch)
    return;
  state.editBooleanCompound(props.object.id, compound, props.project);
  if (useStore.getState().project !== props.project) props.close();
}
function reorderCompoundSource(
  compound: BooleanCompound,
  index: number,
  delta: number,
  setCompound: (value: BooleanCompound) => void,
  setIndex: (value: number) => void,
): void {
  const operands = [...compound.operands];
  const target = index + delta;
  const item = operands[index];
  if (item === undefined || target < 0 || target >= operands.length) return;
  operands.splice(index, 1);
  operands.splice(target, 0, item);
  setIndex(target);
  setCompound({ ...compound, operands });
}

function CompoundSourceEditor({
  compound,
  index,
  setIndex,
  setCompound,
}: {
  readonly compound: BooleanCompound;
  readonly index: number;
  readonly setIndex: (value: number) => void;
  readonly setCompound: (value: BooleanCompound) => void;
}): JSX.Element {
  const operand = compound.operands[index];
  return (
    <>
      <label className="lf-field">
        <span>Retained source</span>
        <select
          className="lf-input"
          aria-label="Retained compound source"
          title="Select a retained source outline to edit. Weld may have separate operation fragments."
          value={index}
          onChange={(event) => setIndex(Number(event.currentTarget.value))}
        >
          {compound.operands.map((item, i) => (
            <option value={i} key={item.object.id}>
              {i + 1}. {item.object.name ?? item.object.source} · {item.sourceId}
            </option>
          ))}
        </select>
      </label>
      <SourceReorder
        index={index}
        count={compound.operands.length}
        move={(delta) => reorderCompoundSource(compound, index, delta, setCompound, setIndex)}
      />
      {operand === undefined ? null : (
        <BooleanCompoundOperandFields
          key={operand.object.id}
          operand={operand}
          change={(edited) =>
            setCompound({
              ...compound,
              operands: compound.operands.map((item, i) => (i === index ? edited : item)),
            })
          }
        />
      )}
    </>
  );
}
