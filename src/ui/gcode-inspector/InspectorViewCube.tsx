// The pointer side of the view cube (ADR-426). The scene draws the cube into
// the canvas corner; this transparent square sits over it, highlights the
// face under the pointer and turns the view on click. It also keeps an orbit
// drag from starting on the cube. The view buttons offer the same views to
// the keyboard and screen readers, so the square itself stays hidden from them.

import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep imports: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dView } from '../viewer3d/camera-presets';
import { VIEW_CUBE_LAYOUT } from '../viewer3d/scene-view-cube';

export function InspectorViewCube(props: {
  readonly handleRef: React.RefObject<Viewer3dSceneHandle | null>;
  readonly onSelectView: (view: Viewer3dView) => void;
}): JSX.Element {
  const faceAt = (event: React.PointerEvent<HTMLDivElement>): Viewer3dView | null => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    return props.handleRef.current?.pickViewCube(x, y) ?? null;
  };
  return (
    <div
      className="gcode-viewer-view-cube"
      aria-hidden="true"
      style={cubeStyle}
      onPointerMove={(event) => props.handleRef.current?.hoverViewCube(faceAt(event))}
      onPointerLeave={() => props.handleRef.current?.hoverViewCube(null)}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => {
        const view = faceAt(event);
        if (view !== null) props.onSelectView(view);
      }}
    />
  );
}

const cubeStyle: React.CSSProperties = {
  right: VIEW_CUBE_LAYOUT.rightPx,
  bottom: VIEW_CUBE_LAYOUT.bottomPx,
  width: VIEW_CUBE_LAYOUT.sizePx,
  height: VIEW_CUBE_LAYOUT.sizePx,
};
