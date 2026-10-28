import { useEffect, useRef, useState } from 'react';
import { outlineBounds, type BoardOutlineDraft, type Vec2 } from '../../../core/scene';
import { Button } from '../../kit';
import { BoardArrayForm } from './BoardArrayForm';
import { BoardFitControls } from './BoardFitControls';
import { OutlinePhotoDialog } from './photo/OutlinePhotoDialog';
import { useBoardPlacement } from './use-board-placement';

const photoKeys = new WeakMap<File, number>();
let nextPhotoKey = 1;

export function OutlineCaptureSteps(props: {
  readonly draft: BoardOutlineDraft | null;
  readonly corners: ReadonlyArray<Vec2>;
  readonly livePosition: Vec2 | null;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onFinish: () => Promise<void>;
  readonly onDraft: (draft: BoardOutlineDraft) => void;
  readonly initialFile?: File | undefined;
  readonly onInitialFileConsumed: () => void;
}): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(props.initialFile !== undefined);
  const seenInitialFile = useRef(props.initialFile);
  useEffect(() => {
    if (props.initialFile === undefined || props.initialFile === seenInitialFile.current) return;
    seenInitialFile.current = props.initialFile;
    setDialogOpen(true);
  }, [props.initialFile]);
  const closeDialog = (): void => {
    setDialogOpen(false);
    props.onInitialFileConsumed();
  };
  return (
    <div style={columnStyle}>
      {props.draft === null ? (
        <>
          <p style={hintStyle}>
            1. Take a photo of the board from straight above, then click its corners on the photo.
          </p>
          <Button
            title="Open a photo of the board and click its outline"
            onClick={() => setDialogOpen(true)}
          >
            Draw board from photo…
          </Button>
        </>
      ) : (
        <DraftCapture {...props} draft={props.draft} onChange={() => setDialogOpen(true)} />
      )}
      {dialogOpen && (
        <OutlinePhotoDialog
          key={photoKey(props.initialFile)}
          initialFile={props.initialFile}
          onClose={closeDialog}
          onUseOutline={(draft) => {
            props.onDraft(draft);
            closeDialog();
          }}
        />
      )}
    </div>
  );
}

function photoKey(file: File | undefined): string {
  if (file === undefined) return 'manual';
  const existing = photoKeys.get(file);
  if (existing !== undefined) return `remote-${existing}`;
  const key = nextPhotoKey;
  nextPhotoKey += 1;
  photoKeys.set(file, key);
  return `remote-${key}`;
}

function DraftCapture(
  props: Parameters<typeof OutlineCaptureSteps>[0] & {
    readonly draft: BoardOutlineDraft;
    readonly onChange: () => void;
  },
): JSX.Element {
  const count = props.corners.length;
  const guidance =
    count === 0
      ? 'Jog the head onto point A on the board, then press Capture.'
      : count === 1
        ? 'Now jog the head onto point B, then press Capture.'
        : 'Both points captured.';
  return (
    <>
      <OutlinePreview draft={props.draft} />
      <Button
        variant="ghost"
        title="Open the photo window again and draw a new outline"
        disabled={props.sessionDisabled}
        onClick={props.onChange}
      >
        Redraw board…
      </Button>
      <OutlineLayout />
      <p style={hintStyle}>
        <strong>3. Register on the laser.</strong> {guidance}
      </p>
      <p style={liveStyle}>
        <strong>Head:</strong>{' '}
        {props.livePosition === null
          ? 'waiting for position…'
          : `X ${props.livePosition.x.toFixed(1)} Y ${props.livePosition.y.toFixed(1)}`}
      </p>
      <div style={rowStyle}>
        <Button
          variant="primary"
          disabled={props.disabled || props.livePosition === null || count >= 2}
          onClick={props.onCapture}
        >
          Capture anchor {count === 0 ? 'A' : 'B'}
        </Button>
        <Button
          variant="ghost"
          disabled={props.sessionDisabled || count === 0}
          onClick={props.onUndo}
        >
          Undo last
        </Button>
      </div>
      <Button
        variant="primary"
        title="Work out where the board sits on the laser from points A and B"
        disabled={props.disabled || count !== 2}
        onClick={() => void props.onFinish().catch(() => undefined)}
      >
        Register board
      </Button>
      <p style={mutedStyle}>
        Register before you Frame and Start. If the board sits at an angle, the outline and the
        artwork on it turn to match. Between points the outline follows the photo, so keep artwork a
        few mm inside the edge.
      </p>
    </>
  );
}

function OutlineLayout(): JSX.Element {
  const { canFit, canArray, fitToBoard, arrayToBoard } = useBoardPlacement();
  return (
    <>
      <p style={hintStyle}>
        <strong>2. Lay out artwork.</strong> The board is on the canvas. Select artwork, then fit or
        repeat it on the board.
      </p>
      <BoardFitControls disabled={!canFit} onFit={fitToBoard} />
      <BoardArrayForm disabled={!canArray} onArray={arrayToBoard} />
    </>
  );
}

function OutlinePreview({ draft }: { readonly draft: BoardOutlineDraft }): JSX.Element {
  const bounds = outlineBounds(draft.localPointsMm);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const points = draft.localPointsMm.map((point) => `${point.x},${point.y}`).join(' ');
  return (
    <svg
      aria-label="Outline anchor preview"
      viewBox={`${bounds.minX} ${bounds.minY} ${width} ${height}`}
      style={{ width: '100%', maxWidth: 240, maxHeight: 160, overflow: 'visible' }}
    >
      <polygon points={points} fill="var(--lf-accent-wash)" stroke="var(--lf-accent)" />
      {draft.anchorIndices.map((index) => {
        const point = draft.localPointsMm[index];
        if (point === undefined) return null;
        const capture = draft.captureOrder.indexOf(index);
        return (
          <g key={index}>
            <circle
              cx={point.x}
              cy={point.y}
              r={Math.max(width, height) / 35}
              fill={capture >= 0 ? 'var(--lf-warning-fg)' : 'var(--lf-bg-1)'}
            />
            <text
              x={point.x}
              y={point.y}
              fontSize={Math.max(width, height) / 14}
              textAnchor="middle"
            >
              {capture === 0 ? 'A' : capture === 1 ? 'B' : index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const liveStyle: React.CSSProperties = { ...hintStyle, fontVariantNumeric: 'tabular-nums' };
const mutedStyle: React.CSSProperties = { ...hintStyle, color: 'var(--lf-text-muted)' };
