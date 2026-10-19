// CaptureCard — the shared body of every board-capture step (ADR-636): what to
// do next, a live map of the points so far, where the head or pointer is,
// a beam-off jog pad to reach the next point, and the capture buttons.

import type { ReactNode } from 'react';
import type { BoardAxisSigns, Vec2 } from '../../../core/scene';
import { Button } from '../../kit';
import { BoardFineJogControls } from './BoardFineJogControls';
import { CaptureMap, type CaptureMapOutline } from './CaptureMap';

/** What the operator is aiming with right now, and where it is (machine mm). */
export type BoardSightView = {
  readonly point: Vec2 | null;
  readonly aim: 'pointer' | 'head';
  readonly signs: BoardAxisSigns;
};

export function CaptureCard(props: {
  readonly title: string;
  readonly progress: string;
  readonly guidance: ReactNode;
  readonly points: ReadonlyArray<Vec2>;
  readonly outline: CaptureMapOutline;
  readonly sight: BoardSightView;
  readonly captureLabel: string;
  readonly captureTitle: string;
  readonly complete: boolean;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onReset: () => void;
  readonly children?: ReactNode;
}): JSX.Element {
  const count = props.points.length;
  const waiting = props.sight.point === null;
  return (
    <div className="lf-place-board__card">
      <div className="lf-place-board__card-title">
        <span>{props.title}</span>
        <span>{props.progress}</span>
      </div>
      <p>{props.guidance}</p>
      <CaptureMap
        points={props.points}
        sight={props.sight.point}
        signs={props.sight.signs}
        outline={props.outline}
        label={`${count} point${count === 1 ? '' : 's'} captured`}
      />
      <SightReadout sight={props.sight} />
      {!props.complete && <BoardFineJogControls disabled={props.disabled} />}
      <div className="lf-place-board__row">
        <button
          type="button"
          className="lf-btn lf-btn--primary lf-place-board__big"
          disabled={props.disabled || waiting || props.complete}
          title={
            waiting
              ? 'Waiting for a live machine position (connect and wait for Idle).'
              : props.captureTitle
          }
          onClick={props.onCapture}
        >
          {props.captureLabel}
        </button>
        <Button
          variant="ghost"
          disabled={props.sessionDisabled || count === 0}
          onClick={props.onUndo}
        >
          Undo last
        </Button>
        {count > 0 && (
          <Button variant="ghost" disabled={props.sessionDisabled} onClick={props.onReset}>
            Start over
          </Button>
        )}
      </div>
      {props.children}
    </div>
  );
}

function SightReadout({ sight }: { readonly sight: BoardSightView }): JSX.Element {
  const who = sight.aim === 'pointer' ? 'Pointer' : 'Head';
  return (
    <div className="lf-place-board__readout">
      <span>{who}:</span>
      <span>
        {sight.point === null
          ? 'waiting for position…'
          : `X ${sight.point.x.toFixed(1)}  Y ${sight.point.y.toFixed(1)}`}
      </span>
    </div>
  );
}
