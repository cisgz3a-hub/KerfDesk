// BoardCapturePanel — "Place Board" assistant (ADR-124). A NON-modal floating
// panel (top-left of the canvas), toggled from the toolbar's Place Board command
// like the registration jig. The operator button-jogs the head (Laser panel) to
// each corner of a placed board; this panel records the machine coordinate, sets
// the work origin at the bottom-left corner, and draws the board's outline (a
// registration box) centred on the canvas so artwork can be positioned on it.

import { useRef, useState } from 'react';
import {
  bestFitRectangleFromCorners,
  boardCornersFromOrigin,
  BOARD_CORNER_COUNT,
} from '../../../core/scene';
import { Button } from '../../kit';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCaptureSteps } from './BoardCaptureSteps';
import { BoardPlacementControls } from './BoardPlacementControls';
import { useBoardCapture } from './use-board-capture';
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
  const capture = useBoardCapture();
  const { connected, disabled } = useCaptureGating();
  // Re-entrancy guard: a synchronous ref (not React state, which wouldn't flip
  // before a rapid second click) so a double-click can't fire the origin write
  // and record the first corner twice during the async setOriginHere gap.
  const capturingRef = useRef(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const livePosition = inferCurrentMachinePosition(statusReport, wcoCache);
  const feed = Math.min(device.maxFeed, BOARD_JOG_FEED_MM_PER_MIN);
  const rect =
    capture.state.corners.length === BOARD_CORNER_COUNT
      ? bestFitRectangleFromCorners(capture.state.corners)
      : null;

  const handleCapture = async (): Promise<void> => {
    if (capturingRef.current || livePosition === null) return;
    capturingRef.current = true;
    setCaptureError(null);
    try {
      // Bottom-left is first: setting the origin there before recording keeps a
      // failed G92 write from committing a corner with no origin behind it.
      if (capture.state.corners.length === 0) await setOriginHere();
      capture.capture(livePosition);
    } catch {
      // setOriginHere writes its reason to the store log; surface a prompt here
      // so the operator isn't left on "Corner 1" with no feedback.
      setCaptureError('Could not set the work origin. Check the machine is idle, then try again.');
    } finally {
      capturingRef.current = false;
    }
  };

  const handleFinish = (): void => {
    if (rect === null) return;
    addCapturedBoardBox(rect.widthMm, rect.heightMm);
    capture.commit();
  };

  // Manual-size path: the origin is already set at the captured bottom-left
  // corner, so draw the outline at the typed size and synthesize the other three
  // corners (so jog-to-corner works like a full capture).
  const handleManualFinish = (widthMm: number, heightMm: number): void => {
    const origin = capture.state.corners[0];
    if (origin === undefined) return;
    addCapturedBoardBox(widthMm, heightMm);
    capture.commitManual(boardCornersFromOrigin(origin, widthMm, heightMm));
  };

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
      {captureError !== null && (
        <p style={errorHintStyle} role="alert">
          {captureError}
        </p>
      )}
      {capture.state.committed ? (
        <BoardPlacementControls
          corners={capture.state.corners}
          feed={feed}
          disabled={disabled}
          onReset={capture.reset}
        />
      ) : (
        <BoardCaptureSteps
          corners={capture.state.corners}
          livePosition={livePosition}
          rect={rect}
          disabled={disabled}
          onCapture={() => void handleCapture().catch(() => undefined)}
          onUndo={capture.undo}
          onFinish={handleFinish}
          onManualSize={handleManualFinish}
          onReset={capture.reset}
        />
      )}
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
