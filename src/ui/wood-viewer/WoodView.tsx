// WoodView — the ported standalone preview as a React component (ADR-285).
//
// Owns a canvas and hands it to the raw-WebGL2 scene. Re-uploads whenever the
// removal grid changes, so adding a word simply re-renders.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemovalGrid } from '../../core/sim';
import {
  CAMERA_PRESETS,
  DEFAULT_FILL,
  DEFAULT_LIGHT_AZIMUTH_DEG,
  DEFAULT_SPECIES,
  DEFAULT_VIEW,
} from './wood-view-palettes';
import { createWoodViewScene, type WoodViewHandle } from './wood-view-scene';
import { WoodViewControls } from './WoodViewControls';

const ORBIT_RADIANS_PER_PX = 0.006;
const MAX_ELEVATION_RAD = 1.5006;
const MIN_ELEVATION_RAD = 0.06;
const MIN_DISTANCE = 0.3;
const MAX_DISTANCE = 3.2;
const ZOOM_PER_WHEEL_UNIT = 0.0012;

export type WoodViewProps = {
  readonly grid: RemovalGrid;
  readonly stockThicknessMm: number;
  readonly heightPx: number;
};

type DragRef = React.MutableRefObject<{ x: number; y: number } | null>;
type SceneRef = React.MutableRefObject<WoodViewHandle | null>;

// Drag orbits, wheel dollies — the reference page's bindings. Split out of the
// component to keep it inside the function-length cap.
function useOrbit(sceneRef: SceneRef, dragRef: DragRef) {
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      dragRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [dragRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const scene = sceneRef.current;
      if (drag === null || scene === null) return;
      const current = scene.getState();
      scene.setState({
        az: current.az - (event.clientX - drag.x) * ORBIT_RADIANS_PER_PX,
        el: Math.max(
          MIN_ELEVATION_RAD,
          Math.min(MAX_ELEVATION_RAD, current.el + (event.clientY - drag.y) * ORBIT_RADIANS_PER_PX),
        ),
      });
      dragRef.current = { x: event.clientX, y: event.clientY };
    },
    [dragRef, sceneRef],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, [dragRef]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const scene = sceneRef.current;
      if (scene === null) return;
      const current = scene.getState();
      scene.setState({
        dist: Math.max(
          MIN_DISTANCE,
          Math.min(MAX_DISTANCE, current.dist * Math.exp(event.deltaY * ZOOM_PER_WHEEL_UNIT)),
        ),
      });
    },
    [sceneRef],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onWheel };
}

export function WoodView(props: WoodViewProps): JSX.Element {
  const { grid, stockThicknessMm, heightPx } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WoodViewHandle | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [species, setSpecies] = useState(DEFAULT_SPECIES);
  const [fill, setFill] = useState(DEFAULT_FILL);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [light, setLight] = useState(DEFAULT_LIGHT_AZIMUTH_DEG);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const scene = createWoodViewScene(canvas);
    if (scene === null) {
      setFailed(true);
      return undefined;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setHeightfield(grid, stockThicknessMm);
  }, [grid, stockThicknessMm]);

  useEffect(() => {
    sceneRef.current?.setState({ species, fill, lightAzimuthDeg: light });
  }, [species, fill, light]);

  const pickView = useCallback((name: string) => {
    setView(name);
    const preset = CAMERA_PRESETS[name];
    if (preset !== undefined) sceneRef.current?.setState(preset);
  }, []);

  const orbit = useOrbit(sceneRef, dragRef);

  if (failed) {
    return (
      <p style={hintStyle} role="alert">
        3D view unavailable in this browser.
      </p>
    );
  }
  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Simulated carve"
        style={{ ...canvasStyle, height: heightPx }}
        onPointerDown={orbit.onPointerDown}
        onPointerMove={orbit.onPointerMove}
        onPointerUp={orbit.onPointerUp}
        onPointerCancel={orbit.onPointerUp}
        onWheel={orbit.onWheel}
      />
      <WoodViewControls
        species={species}
        fill={fill}
        view={view}
        lightAzimuthDeg={light}
        onSpecies={setSpecies}
        onFill={setFill}
        onView={pickView}
        onLight={setLight}
      />
    </>
  );
}

const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  borderRadius: 4,
  touchAction: 'none',
  cursor: 'grab',
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 0 0',
};
