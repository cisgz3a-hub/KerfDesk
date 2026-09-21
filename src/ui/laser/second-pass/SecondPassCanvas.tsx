import type { DeviceProfile } from '../../../core/devices';
import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { SecondPassDrawing } from './second-pass-preview';
import { useSecondPassViewport } from './second-pass-canvas-view';
import { useSecondPassDrawing } from './second-pass-canvas-draw';
import { useSecondPassGesture } from './use-second-pass-gesture';

export type SecondPassTool = 'paint' | 'erase' | 'pan';
export type SecondPassCanvasProps = {
  drawing: SecondPassDrawing;
  preview: SecondPassDrawing | null;
  device: DeviceProfile;
  strokes: LaserSecondPassSelection['strokes'];
  tool: SecondPassTool;
  radiusMm: number;
  powerScale: number;
  disabled: boolean;
  showPreview: boolean;
  onStroke: (stroke: LaserSecondPassSelection['strokes'][number]) => void;
};
export function SecondPassCanvas(props: SecondPassCanvasProps): JSX.Element {
  const viewport = useSecondPassViewport(props.drawing);
  const gesture = useSecondPassGesture(props, viewport);
  const canvases = useSecondPassDrawing(props, viewport, gesture.draft);
  return (
    <div className="second-pass-stage">
      <div className="second-pass-zoom">
        <button
          className="lf-btn lf-btn--sm"
          onClick={() => viewport.zoom(1.5)}
          aria-label="Zoom in"
          title="Magnify the saved engraving for more precise painting."
        >
          +
        </button>
        <button
          className="lf-btn lf-btn--sm"
          onClick={() => viewport.zoom(1 / 1.5)}
          aria-label="Zoom out"
          title="Show more of the saved engraving around the painted areas."
        >
          −
        </button>
        <button
          className="lf-btn lf-btn--sm"
          title="Fit the complete saved engraving in the canvas."
          onClick={viewport.fit}
        >
          Fit job
        </button>
        <span>{viewport.percent}%</span>
      </div>
      <div
        ref={viewport.host}
        className="second-pass-canvas"
        role="img"
        aria-label="Paint second-pass areas on the saved engraving"
        tabIndex={0}
        onPointerDown={gesture.begin}
        onPointerMove={gesture.move}
        onPointerUp={gesture.finish}
        onPointerCancel={gesture.cancel}
        onLostPointerCapture={gesture.cancel}
        onPointerLeave={gesture.leave}
        style={{ cursor: props.tool === 'pan' || props.showPreview ? 'grab' : 'crosshair' }}
      >
        <canvas ref={canvases.background} />
        <canvas ref={canvases.overlay} style={{ opacity: 0.48 }} />
        {gesture.cursor && props.tool !== 'pan' && !props.showPreview && !props.disabled ? (
          <span
            className={`second-pass-brush ${props.tool === 'erase' ? 'is-eraser' : ''}`}
            style={{
              left: gesture.cursor.x,
              top: gesture.cursor.y,
              width: props.radiusMm * 2 * viewport.view.scale,
              height: props.radiusMm * 2 * viewport.view.scale,
            }}
          />
        ) : null}
      </div>
      <p className="second-pass-canvas-caption">
        Scroll to zoom · Hand or Alt-drag to pan · Saved engraving in original work coordinates
      </p>
    </div>
  );
}
