import { useEffect, useRef } from 'react';
import type { RgbaImage } from '../../core/camera';

export function StillCameraOverlay(props: {
  readonly still: RgbaImage;
  readonly matrix: ReadonlyArray<number>;
  readonly opacityPercent: number;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = props.still.width;
    canvas.height = props.still.height;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(props.still.data), props.still.width, props.still.height),
      0,
      0,
    );
  }, [props.still]);
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transformOrigin: '0 0',
        transform: `matrix3d(${props.matrix.join(', ')})`,
        opacity: props.opacityPercent / 100,
        pointerEvents: 'none',
      }}
    />
  );
}
