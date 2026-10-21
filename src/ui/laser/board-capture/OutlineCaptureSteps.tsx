import { useEffect, useRef, useState } from 'react';
import { outlineBounds, type BoardOutlineDraft, type Vec2 } from '../../../core/scene';
import { Button } from '../../kit';
import { OutlinePhotoDialog } from './photo/OutlinePhotoDialog';

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
          <p style={hintStyle}>1. Photograph the board with a sheet of paper lying flat on it.</p>
          <Button onClick={() => setDialogOpen(true)}>Outline from photo…</Button>
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
      ? '2. Jog the head to anchor A, then Capture.'
      : count === 1
        ? '3. Jog the head to anchor B, then Capture.'
        : 'Both registration anchors captured.';
  return (
    <>
      <OutlinePreview draft={props.draft} />
      <Button variant="ghost" disabled={props.sessionDisabled} onClick={props.onChange}>
        Change outline…
      </Button>
      <p style={hintStyle}>{guidance}</p>
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
        disabled={props.disabled || count !== 2}
        onClick={() => void props.onFinish().catch(() => undefined)}
      >
        Create board outline
      </Button>
      <p style={mutedStyle}>
        Anchors land where the head measures them. Between anchors the outline follows the photo,
        usually within about 1 mm. Keep artwork a few mm inside the edge.
      </p>
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
      {draft.anchorIndices.map((index, ordinal) => {
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
              {capture === 0 ? 'A' : capture === 1 ? 'B' : ordinal + 1}
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
