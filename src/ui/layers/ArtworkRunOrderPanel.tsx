import { useEffect, useMemo, useState } from 'react';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { machineKindOf, type Project } from '../../core/scene';
import { useStore } from '../state';
import type { ArtworkNumberingState } from '../state/artwork-run-order-ui';
import { useUiStore } from '../state/ui-store';
import { canvasTheme } from '../theme/canvas-theme';
import { TutorialButton } from '../tutorials/TutorialButton';
import { ArtworkRunOrderList } from './ArtworkRunOrderList';
import { ArtworkRunOrderToolbar } from './ArtworkRunOrderToolbar';
import { artworkRunOrderRows, type ArtworkRunOrderRowModel } from './artwork-run-order-view-model';
import './artwork-run-order.css';

export function ArtworkRunOrderPanel(): JSX.Element {
  const controller = useRunOrderController();
  if (controller.rows.length === 0) {
    return (
      <section className="lf-run-order-empty" aria-label="Run order getting started">
        <span className="lf-run-order-empty-number" aria-hidden="true">
          1 → 2 → 3
        </span>
        <strong>Choose what runs first</strong>
        <p>Import or draw artwork, then arrange it here. Each run has a number you can change.</p>
        <TutorialButton tutorialId="operations" label="Run order tutorial" />
      </section>
    );
  }
  return <ArtworkRunOrderContent controller={controller} />;
}

function useRunOrderController() {
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const selectObjects = useStore((state) => state.selectObjects);
  const moveArtworkToPosition = useStore((state) => state.moveArtworkToPosition);
  const focus = useUiStore((state) => state.artworkRunFocus);
  const setFocus = useUiStore((state) => state.setArtworkRunFocus);
  const numbering = useUiStore((state) => state.artworkNumbering);
  const setView = useUiStore((state) => state.setCutsLayersView);
  const [search, setSearch] = useState('');
  const [jumpPosition, setJumpPosition] = useState('1');
  const [reveal, setReveal] = useState<{ position: number; token: number } | null>(null);
  const rows = useMemo(() => artworkRunOrderRows(project), [project]);
  const filteredRows = useMemo(() => filterRows(rows, search), [rows, search]);
  const activeRow = focusRow(rows, focus?.objectIds[0] ?? null);
  const machineKind = machineKindOf(project.machine);

  useSelectionFocus({ rows, selectedObjectId, activeRow, focus, numbering, setFocus, setReveal });
  useRunOrderCleanup();

  const focusRowAndReveal = (row: ArtworkRunOrderRowModel): void => {
    selectObjects(row.objectIds);
    setFocus(focusForRow(row));
    setReveal((current) => ({ position: row.position, token: (current?.token ?? 0) + 1 }));
  };
  const jumpToRow = (): void => {
    const requested = Math.round(Number(jumpPosition));
    const row = rows.find((candidate) => candidate.position === requested);
    if (row === undefined) return;
    setSearch('');
    focusRowAndReveal(row);
  };
  const numberingActions = useCanvasNumberingActions(project, numbering, setFocus);
  return {
    rows,
    filteredRows,
    activeRow,
    machineKind,
    search,
    setSearch,
    jumpPosition,
    setJumpPosition,
    numbering,
    jumpToRow,
    focusRowAndReveal,
    moveArtworkToPosition,
    setView,
    reveal,
    ...numberingActions,
  };
}

function ArtworkRunOrderContent(props: {
  readonly controller: ReturnType<typeof useRunOrderController>;
}): JSX.Element {
  const controller = props.controller;
  return (
    <div className="lf-run-order">
      <div className="lf-run-order-intro">
        <strong>Choose what runs first</strong>
        <p>Change a run number, or use Number on canvas to click your preferred order.</p>
      </div>
      <ArtworkRunOrderToolbar
        search={controller.search}
        total={controller.rows.length}
        jumpPosition={controller.jumpPosition}
        numbering={
          controller.numbering.kind === 'idle'
            ? controller.numbering
            : {
                kind: 'active',
                nextPosition: controller.numbering.nextPosition,
                canUndo: controller.numbering.assignedUnitKeys.length > 0,
              }
        }
        onSearch={controller.setSearch}
        onJumpPosition={controller.setJumpPosition}
        onJump={controller.jumpToRow}
        onStartNumbering={() => {
          controller.setSearch('');
          controller.startCanvasNumbering();
        }}
        onUndoNumbering={controller.undoCanvasNumbering}
        onDoneNumbering={controller.finishCanvasNumbering}
        onCancelNumbering={controller.cancelCanvasNumbering}
      />
      {controller.machineKind === 'cnc' ? (
        <p className="lf-run-order-note">
          <strong>CNC follows cutting stages.</strong> Clearing runs before profiles, with cuts
          grouped by tool within each stage. Each card shows its actual CNC steps.
        </p>
      ) : null}
      <div className="lf-run-order-list-heading">
        <strong>Run sequence</strong>
        <span role="status">
          {controller.search.trim().length > 0
            ? `${controller.filteredRows.length} of ${controller.rows.length} runs`
            : `${controller.rows.length} ${controller.rows.length === 1 ? 'run' : 'runs'}`}
        </span>
      </div>
      {controller.filteredRows.length === 0 ? (
        <div className="lf-run-order-empty">
          <strong>No matching artwork</strong>
          <p>Try an artwork name, operation or setting.</p>
          <button type="button" className="lf-btn" onClick={() => controller.setSearch('')}>
            Show all runs
          </button>
        </div>
      ) : (
        <ArtworkRunOrderList
          rows={controller.filteredRows}
          total={controller.rows.length}
          activeKey={controller.activeRow?.key ?? null}
          machineKind={controller.machineKind}
          numberingActive={controller.numbering.kind === 'active'}
          reveal={controller.reveal}
          onFocus={controller.focusRowAndReveal}
          onMove={(row, position) => {
            if (!Number.isFinite(position) || position < 1) return;
            controller.moveArtworkToPosition(row.objectIds, position);
          }}
          onEditSettings={(row) => {
            controller.focusRowAndReveal(row);
            controller.setView('layers');
          }}
        />
      )}
    </div>
  );
}

function useSelectionFocus(args: {
  readonly rows: ReadonlyArray<ArtworkRunOrderRowModel>;
  readonly selectedObjectId: string | null;
  readonly activeRow: ArtworkRunOrderRowModel | null;
  readonly focus: ReturnType<typeof useUiStore.getState>['artworkRunFocus'];
  readonly numbering: ArtworkNumberingState;
  readonly setFocus: ReturnType<typeof useUiStore.getState>['setArtworkRunFocus'];
  readonly setReveal: React.Dispatch<
    React.SetStateAction<{ readonly position: number; readonly token: number } | null>
  >;
}): void {
  const { rows, selectedObjectId, activeRow, focus, numbering, setFocus, setReveal } = args;
  useEffect(() => {
    if (numbering.kind === 'active' || selectedObjectId === null) return;
    const row = focusRow(rows, selectedObjectId);
    if (row === null || (row.key === activeRow?.key && row.position === focus?.position)) return;
    setFocus(focusForRow(row));
    setReveal((current) => ({
      position: row.position,
      token: (current?.token ?? 0) + 1,
    }));
  }, [
    activeRow?.key,
    focus?.position,
    numbering.kind,
    rows,
    selectedObjectId,
    setFocus,
    setReveal,
  ]);
}

function useRunOrderCleanup(): void {
  useEffect(
    () => () => {
      if (useUiStore.getState().artworkNumbering.kind === 'active') {
        useStore.getState().cancelInteraction();
        useUiStore.getState().finishArtworkNumbering();
      }
      useUiStore.getState().setArtworkRunFocus(null);
    },
    [],
  );
}

function useCanvasNumberingActions(
  project: Project,
  numbering: ArtworkNumberingState,
  setFocus: ReturnType<typeof useUiStore.getState>['setArtworkRunFocus'],
) {
  const beginInteraction = useStore((state) => state.beginInteraction);
  const endInteraction = useStore((state) => state.endInteraction);
  const cancelInteraction = useStore((state) => state.cancelInteraction);
  const setOrder = useStore((state) => state.setArtworkOrderDuringInteraction);
  const startNumbering = useUiStore((state) => state.startArtworkNumbering);
  const undoNumbering = useUiStore((state) => state.undoArtworkNumbering);
  const finishNumbering = useUiStore((state) => state.finishArtworkNumbering);
  return {
    startCanvasNumbering: () => {
      beginInteraction();
      startNumbering(canonicalArtworkOrder(project.scene));
      setFocus(null);
    },
    undoCanvasNumbering: () => {
      if (numbering.kind !== 'active') return;
      const previous = numbering.orderHistory.at(-2);
      if (previous === undefined) return;
      setOrder(previous);
      undoNumbering();
    },
    finishCanvasNumbering: () => {
      endInteraction();
      finishNumbering();
    },
    cancelCanvasNumbering: () => {
      cancelInteraction();
      finishNumbering();
      setFocus(null);
    },
  };
}

function focusForRow(row: ArtworkRunOrderRowModel) {
  return {
    objectIds: row.objectIds,
    position: row.position,
    color: row.colors[0] ?? canvasTheme.selection,
  };
}

function focusRow(
  rows: ReadonlyArray<ArtworkRunOrderRowModel>,
  objectId: string | null,
): ArtworkRunOrderRowModel | null {
  if (objectId === null) return null;
  return rows.find((row) => row.objectIds.includes(objectId)) ?? null;
}

function filterRows(
  rows: ReadonlyArray<ArtworkRunOrderRowModel>,
  search: string,
): ReadonlyArray<ArtworkRunOrderRowModel> {
  const needle = search.trim().toLocaleLowerCase();
  if (needle.length === 0) return rows;
  return rows.filter((row) =>
    [row.position, row.name, row.kindLabel, row.operationSummary, row.settingsSummary]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle),
  );
}
