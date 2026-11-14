// The Offset Shapes dialog's result operation picker and its notices (ADR-410
// Amendment 6; tools audit T1, T33-P2-1, T33-P2-2 and T33-P3-3).

import { useMemo } from 'react';
import type { VectorSceneObject } from '../../core/geometry';
import type { Result } from '../../core/result';
import type { ImportedSvg, Layer, Scene } from '../../core/scene';
import type { OffsetShapesRequest } from '../state/offset-shapes-actions';
import {
  offsetOperationOffNotice,
  offsetOperationOutput,
  offsetResultOperation,
  offsetResultOperations,
} from '../state/offset-result-operation';
import { offsetNoInwardNotice } from '../state/offset-shapes-notices';

type ArtworkSnapshot = Readonly<Record<string, boolean>> | null;

export type OffsetResultChoice = {
  readonly operations: ReadonlyArray<Layer>;
  readonly operation: Layer | null;
  readonly offNotice: string;
};

/** The operations on offer, the one the result will use, and its output warning. */
export function useOffsetResultOperation(
  scene: Scene,
  targets: ReadonlyArray<VectorSceneObject>,
  selectedIds: ReadonlyArray<string>,
  chosenId: string | undefined,
  snapshot: ArtworkSnapshot,
): OffsetResultChoice {
  const operations = useMemo(() => offsetResultOperations(scene, targets), [scene, targets]);
  const primaryId = selectedIds[0] ?? null;
  const operation = useMemo(
    () =>
      offsetResultOperation(scene, targets, {
        primaryId,
        ...(chosenId === undefined ? {} : { chosenId }),
        snapshot,
      }),
    [scene, targets, primaryId, chosenId, snapshot],
  );
  return { operations, operation, offNotice: offsetOperationOffNotice(operation, snapshot) };
}

/** The shapes the settled preview gives no inward ring, named before Apply. */
export function useNoInwardNotice(
  sources: ReadonlyArray<VectorSceneObject>,
  shown: Result<{ readonly inward: ImportedSvg | null }, unknown> | null,
  request: OffsetShapesRequest,
): string {
  return useMemo(
    () => (shown?.kind === 'ok' ? offsetNoInwardNotice(sources, shown.value.inward, request) : ''),
    [shown, sources, request],
  );
}

export function ResultOperationField(props: {
  readonly choice: OffsetResultChoice;
  readonly snapshot: ArtworkSnapshot;
  readonly style: React.CSSProperties;
  readonly onChange: (operationId: string) => void;
}): JSX.Element | null {
  const { operations, operation } = props.choice;
  if (operations.length === 0) return null;
  return (
    <label style={props.style}>
      <span>Result operation</span>
      <select
        className="lf-input"
        aria-label="Result operation"
        title="The new outlines go on a copy of this operation. The selection is offset as one design, so every outline shares it."
        value={operation?.id ?? ''}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {operations.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name} ({choice.mode}
            {offsetOperationOutput(choice, props.snapshot) ? '' : ', output off'})
          </option>
        ))}
      </select>
    </label>
  );
}

/** The left-out note and the two warnings; empty strings render nothing. */
export function OffsetNotices(props: {
  readonly note: string;
  readonly alerts: ReadonlyArray<string>;
}): JSX.Element {
  return (
    <>
      {props.note === '' ? null : <p role="note">{props.note}</p>}
      {props.alerts
        .filter((alert) => alert !== '')
        .map((alert) => (
          <p key={alert} role="alert">
            {alert}
          </p>
        ))}
    </>
  );
}
