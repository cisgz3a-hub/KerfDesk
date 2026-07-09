// BoardCapturePanel — "Place Board" assistant (ADR-124, generalized to board
// shapes in ADR-126). A NON-modal floating panel (top-left of the canvas),
// toggled from the toolbar's Place Board command. The operator picks a shape
// (Rectangle or Circle), button-jogs the head to the capture points, and this
// records the machine coordinates, sets the work origin (a rectangle's
// bottom-left corner or a circle's centre), and draws the locked outline so
// artwork can be positioned on it.

import { Button } from '../../kit';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePhase } from './BoardCapturePhase';
import { BoardShapeToggle } from './BoardShapeToggle';
import { useBoardCapture } from './use-board-capture';
import { useBoardCaptureHandlers } from './use-board-capture-handlers';
import { useCaptureGating } from './use-capture-gating';

// Positioning feed cap, matching the JogPad's fast-jog rate.
const BOARD_JOG_FEED_MM_PER_MIN = 3000;

export function BoardCapturePanel(): JSX.Element | null {
  const open = useUiStore((s) => s.boardCapturePanelOpen);
  const close = useUiStore((s) => s.closeBoardCapturePanel);
  const statusReport = useLaserStore((s) => s.statusReport);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const setOriginHere = useLaserStore((s) => s.setOriginHere);
  const device = useStore((s) => s.project.device);
  const addCapturedBoardBox = useStore((s) => s.addCapturedBoardBox);
  const addCapturedBoard = useStore((s) => s.addCapturedBoard);
  const capture = useBoardCapture();
  const { connected, disabled } = useCaptureGating();

  const livePosition = inferCurrentMachinePosition(statusReport, wcoCache);
  const feed = Math.min(device.maxFeed, BOARD_JOG_FEED_MM_PER_MIN);
  const { shapeKind, corners, committed, shape } = capture.state;
  const circleDiameter = shape?.kind === 'circle' ? shape.diameterMm : null;
  const handlers = useBoardCaptureHandlers({
    capture,
    livePosition,
    setOriginHere,
    addCapturedBoardBox,
    addCapturedBoard,
  });

  if (!open) return null;
  return (
    <section aria-label="Place board" className="lf-chip" style={panelStyle}>
      <header style={headerStyle}>
        <strong>Place Board</strong>
        <Button variant="ghost" aria-label="Close board capture panel" onClick={close}>
          ×
        </Button>
      </header>
      {!connected && <p style={hintStyle}>Connect the machine to capture a board.</p>}
      {handlers.captureError !== null && (
        <p style={errorHintStyle} role="alert">
          {handlers.captureError}
        </p>
      )}
      {!committed && <BoardShapeToggle shapeKind={shapeKind} onChange={capture.setShape} />}
      <BoardCapturePhase
        committed={committed}
        shapeKind={shapeKind}
        corners={corners}
        circleDiameter={circleDiameter}
        rect={handlers.rect}
        livePosition={livePosition}
        disabled={disabled}
        feed={feed}
        onCapture={handlers.onCapture}
        onUndo={capture.undo}
        onFinishRect={handlers.onFinishRect}
        onManualSize={handlers.onManualSize}
        onFinishCircle={handlers.onFinishCircle}
        onReset={capture.reset}
      />
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  width: 260,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 12,
  boxShadow: 'var(--lf-shadow)',
  pointerEvents: 'auto',
  fontSize: 13,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  fontStyle: 'italic',
};
const errorHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-danger-fg)',
};
